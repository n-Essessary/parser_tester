import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

const DEFAULT_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 25000);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 1_500_000);

function browserHeadersFor(target, requestUrl) {
  const targetOrigin = new URL(target.url).origin;
  const requestOrigin = new URL(requestUrl).origin;
  return {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    "origin": targetOrigin,
    "pragma": "no-cache",
    "referer": target.url,
    "sec-ch-ua": "\"Chromium\";v=\"149\", \"Google Chrome\";v=\"149\", \"Not-A.Brand\";v=\"99\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": requestOrigin === targetOrigin ? "same-origin" : "cross-site",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": process.env.USER_AGENT ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
  };
}

const blockPatterns = [
  ["cloudflare_challenge", /cf-chl|cf_clearance|checking your browser|just a moment|challenge-platform/i],
  ["captcha", /captcha|hcaptcha|recaptcha|g-recaptcha|turnstile/i],
  ["access_denied", /access denied|forbidden|request blocked|blocked by|not authorized/i],
  ["rate_limit", /too many requests|rate limit|temporarily unavailable/i],
  ["js_required", /enable javascript|javascript is disabled|requires javascript/i],
  ["akamai", /akamai|_abck|ak_bmsc|bm_sz|bm_ss|bm_mi/i],
  ["perimeterx", /perimeterx|px-captcha|_px/i],
  ["datadome", /datadome|ddos-guard/i],
  ["distil", /distil|incapsula|imperva/i]
];

function pickHeaders(headers) {
  const interesting = [
    "server",
    "content-type",
    "content-length",
    "cache-control",
    "location",
    "set-cookie",
    "cf-mitigated",
    "cf-ray",
    "cf-cache-status",
    "x-cache",
    "x-frame-options",
    "strict-transport-security"
  ];

  const result = {};
  for (const key of interesting) {
    const value = headers.get(key);
    if (value) {
      result[key] = key === "set-cookie" ? summarizeCookie(value) : value;
    }
  }
  return result;
}

function summarizeCookie(value) {
  return value
    .split(",")
    .slice(0, 8)
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean);
}

function titleFromHtml(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? normalizeText(match[1]).slice(0, 200) : null;
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values, limit = 80) {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function detectSignals(status, headers, html) {
  const source = `${status}\n${JSON.stringify(pickHeaders(headers))}\n${html.slice(0, 200000)}`;
  const signals = {};
  for (const [name, pattern] of blockPatterns) {
    signals[name] = pattern.test(source);
  }

  signals.uses_cloudflare = /cloudflare/i.test(headers.get("server") ?? "") || Boolean(headers.get("cf-ray"));
  signals.cf_mitigated_challenge = /challenge/i.test(headers.get("cf-mitigated") ?? "");
  signals.http_block_status = [401, 403, 407, 418, 429, 451, 503].includes(status);
  signals.empty_or_tiny_html = html.length > 0 && html.length < 2000;
  signals.contains_html = /<html|<body|<!doctype html/i.test(html);
  signals.has_next_data = /<script[^>]+id=["']__NEXT_DATA__["']/i.test(html);
  signals.has_nuxt_data = /window\.__NUXT__|__NUXT_DATA__/i.test(html);
  signals.has_json_ld = /application\/ld\+json/i.test(html);
  signals.has_visible_offer_terms = /gold|price|seller|server|alliance|horde|delivery/i.test(html);
  signals.normal_body_likely = status === 200 &&
    signals.contains_html &&
    html.length >= 2000 &&
    !signals.empty_or_tiny_html &&
    !signals.cloudflare_challenge &&
    !signals.captcha &&
    !signals.access_denied;
  signals.cloudflare_asn_block_likely = signals.uses_cloudflare && (
    status === 403 ||
    status === 503 ||
    signals.cf_mitigated_challenge ||
    signals.cloudflare_challenge
  );

  const blocked = signals.http_block_status ||
    signals.cloudflare_challenge ||
    signals.cf_mitigated_challenge ||
    signals.captcha ||
    signals.access_denied ||
    signals.rate_limit ||
    signals.perimeterx ||
    signals.datadome ||
    signals.distil;

  return {
    blocked_likely: blocked,
    direct_http_promising: !blocked && signals.normal_body_likely,
    signals
  };
}

function extractScriptHints(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .slice(0, 20);

  const apiLike = [...html.matchAll(/["']([^"']*(?:api|graphql|search|offer|listing|product|gold)[^"']*)["']/gi)]
    .map((match) => match[1])
    .filter((value) => value.length < 300)
    .slice(0, 30);

  return {
    script_src_sample: scripts,
    api_like_string_sample: [...new Set(apiLike)]
  };
}

const errorPagePattern = /oops|something gone missing|page you(?:'|’)re looking for|not found|404|page not found|does not exist|temporarily unavailable/i;
const challengeTitlePattern = /just a moment|attention required|access denied|captcha|security check|verify you are human|forbidden/i;
const pricePattern = /(?:[$€£]\s?\d+(?:[.,]\d{1,6})?)|(?:\b\d+(?:[.,]\d{1,6})?\s*(?:\/|\s+per\s+|-per-)?\s?(?:1k|k|unit|gold)\b)|(?:\bper[-\s]?(?:1k|k|unit)\b)/i;
const stockPattern = /\b(?:stock|qty|quantity|amount|available|delivery|in stock)\b[:\s-]*([0-9][0-9,.\skKmMbB]*)?/i;
const serverLabelPattern = /\b(?:server|realm|region|faction)\b[:\s-]*([A-Za-z][A-Za-z0-9'’(). -]{2,70})/i;
const realmNamePattern = /\b(?:Benediction|Faerlina|Grobbulus|Mankrik|Whitemane|Gehennas|Firemaw|Pyrewood Village|Mirage Raceway|Earthshaker|Mograine|Nethergarde Keep|Atiesh|Pagle|Mankrik|Windseeker|Bloodsail Buccaneers|Ashkandi|Sulfuras|Auberdine|Everlook|Lakeshire|Venoxis|Pyrewood|Ragnaros|Illidan|Area 52|Stormrage|Tichondrius|Draenor|Silvermoon|Twisting Nether|Kazzak)\b/i;

function cleanCandidateText(value) {
  return normalizeText(value.replace(/\u00a0/g, " ")).slice(0, 900);
}

function extractPrice(text) {
  const match = text.match(pricePattern);
  return match ? normalizeText(match[0]) : null;
}

function extractServer(text) {
  const labeled = text.match(serverLabelPattern);
  if (labeled?.[1]) {
    return normalizeText(labeled[1]).replace(/\s+(price|stock|qty|quantity|delivery|seller)\b.*$/i, "").slice(0, 80);
  }

  const realm = text.match(realmNamePattern);
  if (realm?.[0]) {
    return normalizeText(realm[0]);
  }

  const factionRegion = text.match(/\b([A-Za-z][A-Za-z'’ -]{2,45})\s*[-/|]\s*(?:Alliance|Horde|EU|US|NA|OC|Classic|Retail)\b/i);
  return factionRegion?.[1] ? normalizeText(factionRegion[1]).slice(0, 80) : null;
}

function extractOfferRows(html) {
  const $ = cheerio.load(html);
  const rows = [];
  const selectorGroups = [
    { selector: "[class*='product'], [class*='offer'], [class*='goods'], [class*='list'], [class*='card'], [class*='item']", pattern: "semantic-class-price-server" },
    { selector: "tr, li, article, a, div", pattern: "generic-node-price-server" }
  ];
  const seen = new Set();
  let matchedPattern = null;

  for (const group of selectorGroups) {
    $(group.selector).each((_, element) => {
      if (rows.length >= 25) {
        return;
      }

      const text = cleanCandidateText($(element).text());
      if (text.length < 12 || text.length > 900 || seen.has(text)) {
        return;
      }

      const price = extractPrice(text);
      const server = extractServer(text);
      if (!price || !server) {
        return;
      }

      seen.add(text);
      matchedPattern ??= group.pattern;
      const stock = text.match(stockPattern)?.[1] ?? (stockPattern.test(text) ? "mentioned" : null);
      rows.push({
        price,
        server,
        stock: stock ? normalizeText(stock) : null,
        text: text.slice(0, 240)
      });
    });

    if (rows.length > 0) {
      break;
    }
  }

  return {
    offer_rows_found: rows.length,
    sample_rows: rows.slice(0, 5),
    static_extraction_pattern: matchedPattern
  };
}

function discoverApiCandidates(html, requestUrl) {
  const $ = cheerio.load(html);
  const candidates = [];
  const request = new URL(requestUrl);
  const hostPattern = request.hostname.replace(/^www\./, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  $("[href], [src]").each((_, element) => {
    const value = $(element).attr("href") ?? $(element).attr("src");
    if (!value || !/(api|graphql|_next|nuxt|search|offer|listing|product|gold)/i.test(value)) {
      return;
    }
    try {
      candidates.push(new URL(value, requestUrl).toString());
    } catch {
      candidates.push(value);
    }
  });

  const scriptTexts = $("script").map((_, element) => $(element).html() ?? "").get();
  const source = scriptTexts.join("\n").slice(0, 2_000_000);
  const patterns = [
    /https?:\/\/api\.[^"'`\s)]+/gi,
    new RegExp(`https?:\\/\\/[^"'\\\`\\s)]*${hostPattern}[^"'\\\`\\s)]*(?:api|graphql|search|offer|listing|product|gold)[^"'\\\`\\s)]*`, "gi"),
    /["'`](\/(?:api|graphql|_next\/data|_nuxt|search|offers?|listings?|products?)[^"'`\s)]*)["'`]/gi,
    /\bfetch\(\s*["'`]([^"'`]+)["'`]/gi,
    /\b(?:url|endpoint|path)\s*:\s*["'`]([^"'`]*(?:api|graphql|search|offer|listing|product|gold)[^"'`]*)["'`]/gi
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1] ?? match[0];
      if (!value || value.length > 500) {
        continue;
      }
      try {
        candidates.push(new URL(value, requestUrl).toString());
      } catch {
        candidates.push(value);
      }
    }
  }

  const nextData = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (nextData) {
    try {
      const buildId = JSON.parse(nextData).buildId;
      if (buildId) {
        candidates.push(new URL(`/_next/data/${buildId}/`, requestUrl).toString());
      }
    } catch {
      // Best-effort static discovery only.
    }
  }

  return unique(candidates.map((value) => value.replace(/\\u002F/g, "/")), 80);
}

function classifyContent(status, html, detection, body, offers) {
  if (detection.signals.cloudflare_challenge || detection.signals.cf_mitigated_challenge) {
    return "challenge_shell";
  }

  const title = body.title ?? "";
  const snippet = body.snippet ?? "";
  if (
    status === 200 &&
    (errorPagePattern.test(`${title}\n${snippet}`) ||
      challengeTitlePattern.test(title) ||
      html.length < 2000 ||
      offers.offer_rows_found === 0)
  ) {
    return "soft_block_or_error";
  }

  if (status === 200 && offers.offer_rows_found > 0) {
    return "real_listing";
  }

  return status >= 400 || detection.blocked_likely ? "soft_block_or_error" : "unknown";
}

function analyzeListingHtml(status, html, detection, body, requestUrl) {
  const offers = extractOfferRows(html);
  const api_candidates = discoverApiCandidates(html, requestUrl);
  const content_classification = classifyContent(status, html, detection, body, offers);
  const requires_js = (detection.signals.has_next_data || detection.signals.has_nuxt_data) && offers.offer_rows_found === 0;
  const scrapeable_static = offers.offer_rows_found > 0 && content_classification === "real_listing";

  return {
    content_classification,
    scrapeable_static,
    requires_js,
    offer_rows_found: offers.offer_rows_found,
    sample_rows: offers.sample_rows,
    static_extraction_pattern: offers.static_extraction_pattern,
    api_candidates
  };
}

function verdictFor(status, html, detection) {
  if (status === 403 || status === 503 || detection.signals.cf_mitigated_challenge) {
    return "blocked_asn_or_challenge";
  }
  if (detection.blocked_likely) {
    return "blocked_or_challenged";
  }
  if (status >= 200 && status < 300 && html.length > 5000) {
    return detection.signals.has_visible_offer_terms ? "direct_http_access_ok" : "html_access_ok_needs_data_source_analysis";
  }
  if (status >= 300 && status < 400) {
    return "redirect_response";
  }
  if (status >= 400) {
    return "http_error";
  }
  return "inconclusive";
}

function killSwitchFor(status, detection) {
  const cloudflareAsnKillSwitch = detection.signals.cf_mitigated_challenge ||
    (detection.signals.uses_cloudflare && (
      status === 403 ||
      status === 503 ||
      detection.signals.cloudflare_challenge
    ));

  if (cloudflareAsnKillSwitch) {
    return {
      triggered: true,
      reason: "cloudflare_or_asn_block",
      can_continue: false,
      recommendation: "Cloudflare likely blocks datacenter ASN. Use residential proxy or partner traffic source."
    };
  }

  if (status === 403 || status === 503) {
    return {
      triggered: true,
      reason: "edge_waf_or_asn_block",
      can_continue: false,
      recommendation: "Edge WAF likely blocks datacenter ASN. Use residential proxy or partner traffic source."
    };
  }

  if (status === 200 && detection.signals.normal_body_likely && !detection.blocked_likely) {
    return {
      triggered: false,
      reason: "http_ok_normal_body",
      can_continue: true,
      recommendation: "HTTP probe passed, scraping checks may continue."
    };
  }

  return {
    triggered: true,
    reason: "inconclusive_or_soft_block",
    can_continue: false,
    recommendation: "Response does not match pass criteria. Re-check with browser and/or proxy before scraping."
  };
}

export async function runHttpDiagnostic(target, options = {}) {
  const startedAt = new Date();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requestUrl = options.url ?? target.url;
  const endpoint = options.endpoint ?? null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: browserHeadersFor(target, requestUrl),
      redirect: "follow",
      signal: controller.signal
    });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer).subarray(0, MAX_BODY_BYTES);
    const html = buffer.toString("utf8");
    const detection = detectSignals(response.status, response.headers, html);
    const kill_switch = killSwitchFor(response.status, detection);
    const body = {
      bytes_read: buffer.length,
      truncated: arrayBuffer.byteLength > MAX_BODY_BYTES,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      title: titleFromHtml(html),
      snippet: normalizeText(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).slice(0, 1200)
    };
    const listing_analysis = endpoint === "listing"
      ? analyzeListingHtml(response.status, html, detection, body, requestUrl)
      : null;

    return {
      ok: true,
      target: target.name,
      endpoint,
      requested_url: requestUrl,
      final_url: response.url,
      status: response.status,
      status_text: response.statusText,
      redirected: response.redirected,
      duration_ms: Date.now() - startedAt.getTime(),
      checked_at: startedAt.toISOString(),
      response_headers: pickHeaders(response.headers),
      body,
      detection,
      kill_switch,
      extraction_hints: extractScriptHints(html),
      listing_analysis,
      verdict: verdictFor(response.status, html, detection)
    };
  } catch (error) {
    return {
      ok: false,
      target: target.name,
      endpoint,
      requested_url: requestUrl,
      duration_ms: Date.now() - startedAt.getTime(),
      checked_at: startedAt.toISOString(),
      error: {
        name: error.name,
        message: error.message,
        cause: error.cause?.code ?? error.cause?.message ?? null
      },
      kill_switch: {
        triggered: true,
        reason: "network_or_timeout_error",
        can_continue: false,
        recommendation: "Network error during kill-switch probe. Retry from deployment host."
      },
      verdict: error.name === "AbortError" ? "timeout" : "network_or_tls_error"
    };
  } finally {
    clearTimeout(timeout);
  }
}
