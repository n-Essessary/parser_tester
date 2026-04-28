import { createHash } from "node:crypto";

const DEFAULT_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 25000);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 1_500_000);

const browserHeaders = {
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  "pragma": "no-cache",
  "sec-ch-ua": "\"Chromium\";v=\"124\", \"Google Chrome\";v=\"124\", \"Not-A.Brand\";v=\"99\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"Windows\"",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "user-agent": process.env.USER_AGENT ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
};

const blockPatterns = [
  ["cloudflare_challenge", /cf-chl|cf_clearance|checking your browser|just a moment|challenge-platform/i],
  ["captcha", /captcha|hcaptcha|recaptcha|g-recaptcha|turnstile/i],
  ["access_denied", /access denied|forbidden|request blocked|blocked by|not authorized/i],
  ["rate_limit", /too many requests|rate limit|temporarily unavailable/i],
  ["js_required", /enable javascript|javascript is disabled|requires javascript/i],
  ["akamai", /akamai|_abck|bm_sz/i],
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

function detectSignals(status, headers, html) {
  const source = `${status}\n${JSON.stringify(pickHeaders(headers))}\n${html.slice(0, 200000)}`;
  const signals = {};
  for (const [name, pattern] of blockPatterns) {
    signals[name] = pattern.test(source);
  }

  signals.uses_cloudflare = /cloudflare/i.test(headers.get("server") ?? "") || Boolean(headers.get("cf-ray"));
  signals.http_block_status = [401, 403, 407, 418, 429, 451, 503].includes(status);
  signals.empty_or_tiny_html = html.length > 0 && html.length < 2000;
  signals.has_next_data = /<script[^>]+id=["']__NEXT_DATA__["']/i.test(html);
  signals.has_nuxt_data = /window\.__NUXT__|__NUXT_DATA__/i.test(html);
  signals.has_json_ld = /application\/ld\+json/i.test(html);
  signals.has_visible_offer_terms = /gold|price|seller|server|alliance|horde|delivery/i.test(html);

  const blocked = signals.http_block_status ||
    signals.cloudflare_challenge ||
    signals.captcha ||
    signals.access_denied ||
    signals.rate_limit ||
    signals.perimeterx ||
    signals.datadome ||
    signals.distil;

  return {
    blocked_likely: blocked,
    direct_http_promising: !blocked && status >= 200 && status < 400 && html.length > 5000,
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

function verdictFor(status, html, detection) {
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

export async function runHttpDiagnostic(target, options = {}) {
  const startedAt = new Date();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(target.url, {
      method: "GET",
      headers: browserHeaders,
      redirect: "follow",
      signal: controller.signal
    });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer).subarray(0, MAX_BODY_BYTES);
    const html = buffer.toString("utf8");
    const detection = detectSignals(response.status, response.headers, html);

    return {
      ok: true,
      target: target.name,
      requested_url: target.url,
      final_url: response.url,
      status: response.status,
      status_text: response.statusText,
      redirected: response.redirected,
      duration_ms: Date.now() - startedAt.getTime(),
      checked_at: startedAt.toISOString(),
      response_headers: pickHeaders(response.headers),
      body: {
        bytes_read: buffer.length,
        truncated: arrayBuffer.byteLength > MAX_BODY_BYTES,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        title: titleFromHtml(html),
        snippet: normalizeText(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).slice(0, 1200)
      },
      detection,
      extraction_hints: extractScriptHints(html),
      verdict: verdictFor(response.status, html, detection)
    };
  } catch (error) {
    return {
      ok: false,
      target: target.name,
      requested_url: target.url,
      duration_ms: Date.now() - startedAt.getTime(),
      checked_at: startedAt.toISOString(),
      error: {
        name: error.name,
        message: error.message,
        cause: error.cause?.code ?? error.cause?.message ?? null
      },
      verdict: error.name === "AbortError" ? "timeout" : "network_or_tls_error"
    };
  } finally {
    clearTimeout(timeout);
  }
}
