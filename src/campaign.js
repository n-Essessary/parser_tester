import { runHttpDiagnostic } from "./httpDiagnostic.js";
import { config, targets } from "./targets.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function dedupe(values, limit = 80) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

export function compactLogResult(result) {
  return {
    ok: result.ok,
    target: result.target,
    endpoint: result.endpoint ?? null,
    status: result.status ?? null,
    final_url: result.final_url ?? null,
    duration_ms: result.duration_ms,
    verdict: result.verdict,
    blocked_likely: result.detection?.blocked_likely ?? null,
    direct_http_promising: result.detection?.direct_http_promising ?? null,
    signals: result.detection?.signals ?? null,
    kill_switch: result.kill_switch ?? null,
    response_headers: result.response_headers ?? null,
    title: result.body?.title ?? null,
    bytes_read: result.body?.bytes_read ?? null,
    snippet: result.body?.snippet ? result.body.snippet.slice(0, 350) : null,
    error: result.error ?? null,
    content_classification: result.listing_analysis?.content_classification ?? null,
    scrapeable_static: result.listing_analysis?.scrapeable_static ?? null,
    requires_js: result.listing_analysis?.requires_js ?? null,
    offer_rows_found: result.listing_analysis?.offer_rows_found ?? null,
    sample_rows: result.listing_analysis?.sample_rows ?? null,
    static_extraction_pattern: result.listing_analysis?.static_extraction_pattern ?? null,
    api_candidates: result.listing_analysis?.api_candidates ?? null
  };
}

function emptyReport() {
  return {
    checked_at: new Date().toISOString(),
    completed_at: null,
    running: false,
    window_min: config.probe.windowMin,
    interval_min: config.probe.intervalMin,
    environment: null,
    results: {},
    diagnostics: {}
  };
}

export const latestReport = emptyReport();

function attemptFromResult(key, url, result) {
  return {
    checked_at: result.checked_at ?? new Date().toISOString(),
    key,
    target: result.target,
    url,
    status: result.status ?? null,
    verdict: result.verdict,
    content_classification: result.listing_analysis?.content_classification ?? null,
    scrapeable_static: result.listing_analysis?.scrapeable_static ?? false,
    requires_js: result.listing_analysis?.requires_js ?? false,
    offer_rows_found: result.listing_analysis?.offer_rows_found ?? 0,
    sample_rows: result.listing_analysis?.sample_rows ?? [],
    api_candidates: result.listing_analysis?.api_candidates ?? [],
    blocked_likely: result.detection?.blocked_likely ?? false,
    cloudflare_challenge: result.detection?.signals?.cloudflare_challenge ?? false,
    captcha: result.detection?.signals?.captcha ?? false,
    akamai: result.detection?.signals?.akamai ?? false,
    datadome: result.detection?.signals?.datadome ?? false,
    error: result.error ?? null
  };
}

function aggregateTarget(key, state, homeResult) {
  const attempts = state.attempts;
  const total = attempts.length;
  const okAttempts = attempts.filter((attempt) => attempt.status && attempt.status >= 200 && attempt.status < 400);
  const realListings = attempts.filter((attempt) => attempt.content_classification === "real_listing");
  const staticListings = realListings.filter((attempt) => attempt.scrapeable_static);
  const offerRows = attempts.map((attempt) => attempt.offer_rows_found);
  const successRate = total ? okAttempts.length / total : 0;
  const realListingRate = total ? realListings.length / total : 0;
  const offerRowsMedian = median(offerRows);
  const anyChallenge = attempts.some((attempt) => attempt.cloudflare_challenge || attempt.captcha);
  const intermittentChallenge = anyChallenge && attempts.some((attempt) => attempt.content_classification === "real_listing");
  const persistentHardBlock = total > 0 && attempts.every((attempt) => (
    attempt.cloudflare_challenge ||
    attempt.captcha ||
    attempt.akamai ||
    attempt.datadome ||
    [401, 403, 407, 418, 429, 451, 503].includes(attempt.status)
  ));
  const requiresJs = attempts.some((attempt) => attempt.requires_js);
  const scrapeableStatic = staticListings.length > 0;
  const apiCandidates = dedupe(attempts.flatMap((attempt) => attempt.api_candidates));
  const strongApiCandidates = apiCandidates.filter((candidate) => /(?:^https?:\/\/api\.|\/api\/|\/graphql\b|_next\/data\/)/i.test(candidate));
  const sampleRows = attempts.flatMap((attempt) => attempt.sample_rows).slice(0, 5);
  const listingStatuses = attempts.map((attempt) => ({
    url: attempt.url,
    status: attempt.status,
    content_classification: attempt.content_classification,
    offer_rows_found: attempt.offer_rows_found,
    checked_at: attempt.checked_at
  }));

  let verdict = "no_go";
  let reason = "No listing attempts produced parseable static offer rows.";
  if (
    realListingRate > config.probe.minRealListingRate &&
    scrapeableStatic &&
    offerRowsMedian >= config.probe.offerRowsThreshold &&
    !intermittentChallenge
  ) {
    verdict = "go";
    reason = "Majority of listing attempts returned real static listings with parseable offer rows.";
  } else if (scrapeableStatic) {
    verdict = "conditional";
    reason = intermittentChallenge
      ? "Static offers are present, but challenge/captcha signals appeared intermittently."
      : "Static offers are present, but success rate or row counts are below the go threshold.";
  } else if (requiresJs) {
    verdict = "conditional";
    reason = "Listing HTML contains app data but no parseable static offer rows; likely requires JS or an internal API follow-up.";
  } else if (strongApiCandidates.length > 0 && !persistentHardBlock) {
    verdict = "conditional";
    reason = "No static offer rows found, but static HTML exposed API candidates for follow-up.";
  } else if (persistentHardBlock) {
    reason = "Persistent hard block or challenge signals on listing URLs.";
  }

  return {
    verdict,
    reason,
    success_rate: Number(successRate.toFixed(3)),
    real_listing_rate: Number(realListingRate.toFixed(3)),
    offer_rows_median: offerRowsMedian,
    scrapeable_static: scrapeableStatic,
    requires_js: requiresJs,
    api_candidates: apiCandidates,
    sample_rows: sampleRows,
    home_status: homeResult?.status ?? null,
    listing_statuses: listingStatuses
  };
}

function aggregateUrl(attempts) {
  const total = attempts.length;
  const realListings = attempts.filter((attempt) => attempt.content_classification === "real_listing");
  return {
    attempts: total,
    success_rate: total ? Number((attempts.filter((attempt) => attempt.status && attempt.status >= 200 && attempt.status < 400).length / total).toFixed(3)) : 0,
    real_listing_rate: total ? Number((realListings.length / total).toFixed(3)) : 0,
    first_status: attempts[0]?.status ?? null,
    last_status: attempts.at(-1)?.status ?? null,
    intermittent_cloudflare_challenge: attempts.some((attempt) => attempt.cloudflare_challenge) && attempts.some((attempt) => !attempt.cloudflare_challenge),
    intermittent_captcha: attempts.some((attempt) => attempt.captcha) && attempts.some((attempt) => !attempt.captcha),
    offer_rows_median: median(attempts.map((attempt) => attempt.offer_rows_found))
  };
}

export async function runProbeCampaign({ environmentInfo } = {}) {
  latestReport.checked_at = new Date().toISOString();
  latestReport.completed_at = null;
  latestReport.running = true;
  latestReport.window_min = config.probe.windowMin;
  latestReport.interval_min = config.probe.intervalMin;
  latestReport.environment = environmentInfo?.() ?? null;
  latestReport.results = {};
  latestReport.diagnostics = {};

  const state = Object.fromEntries(Object.keys(targets).map((key) => [key, { attempts: [], home: null }]));
  const endAt = Date.now() + Math.max(config.probe.windowMin, 0) * 60_000;
  const intervalMs = Math.max(config.probe.intervalMin, 0) * 60_000;
  let round = 0;

  console.log("[startup-check] starting listing probe campaign");

  for (const [key, target] of Object.entries(targets)) {
    const result = await runHttpDiagnostic(target, { endpoint: "home", url: target.url });
    state[key].home = result;
    console.log("[startup-check:" + key + "] " + JSON.stringify(compactLogResult(result)));
  }

  do {
    round += 1;
    for (const [key, target] of Object.entries(targets)) {
      for (const listingUrl of target.listingUrls) {
        const jitter = Math.floor(Math.random() * Math.max(config.probe.maxJitterMs, 0));
        if (jitter > 0) {
          await sleep(jitter);
        }

        const result = await runHttpDiagnostic(target, { endpoint: "listing", url: listingUrl });
        const attempt = attemptFromResult(key, listingUrl, result);
        state[key].attempts.push(attempt);

        console.log("[probe:" + key + "] " + JSON.stringify({
          round,
          url: listingUrl,
          ...compactLogResult(result)
        }));
      }
    }

    for (const [key, targetState] of Object.entries(state)) {
      latestReport.results[key] = aggregateTarget(key, targetState, targetState.home);
      latestReport.diagnostics[key] = Object.fromEntries(
        dedupe(targetState.attempts.map((attempt) => attempt.url), 500).map((url) => [
          url,
          aggregateUrl(targetState.attempts.filter((attempt) => attempt.url === url))
        ])
      );
    }

    if (intervalMs <= 0 || Date.now() + intervalMs > endAt) {
      break;
    }
    await sleep(intervalMs);
  } while (Date.now() <= endAt);

  latestReport.completed_at = new Date().toISOString();
  latestReport.running = false;
  console.log("[verdict:summary] " + JSON.stringify({
    checked_at: latestReport.completed_at,
    window_min: latestReport.window_min,
    interval_min: latestReport.interval_min,
    results: latestReport.results
  }));

  return latestReport;
}
