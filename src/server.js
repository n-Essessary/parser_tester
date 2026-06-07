import http from "node:http";
import { latestReport, runProbeCampaign } from "./campaign.js";
import { runHttpDiagnostic } from "./httpDiagnostic.js";
import { getTarget, targets } from "./targets.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const runStartupCheck = process.env.STARTUP_CHECK !== "false";

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendText(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function environmentInfo() {
  return {
    node: process.version,
    platform: process.platform,
    uptime_sec: Math.round(process.uptime()),
    coolify: Boolean(process.env.COOLIFY_URL || process.env.COOLIFY_FQDN || process.env.COOLIFY_BRANCH),
    coolify_url: process.env.COOLIFY_URL ?? null,
    coolify_fqdn: process.env.COOLIFY_FQDN ?? null,
    railway: Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID),
    railway_environment: process.env.RAILWAY_ENVIRONMENT ?? null,
    railway_service: process.env.RAILWAY_SERVICE_NAME ?? null
  };
}

async function handleCheck(req, res, targetKey) {
  const target = getTarget(targetKey);
  if (!target) {
    sendJson(res, 404, {
      error: "unknown_target",
      available_targets: Object.keys(targets)
    });
    return;
  }

  const result = await runTargetListingCheck(target);
  sendJson(res, 200, {
    environment: environmentInfo(),
    key: targetKey,
    ...result
  });
}

async function runTargetListingCheck(target) {
  const checks = [
    await runHttpDiagnostic(target, { endpoint: "home", url: target.url })
  ];
  for (const url of target.listingUrls) {
    checks.push(await runHttpDiagnostic(target, { endpoint: "listing", url }));
  }

  const listingChecks = checks.filter((item) => item.endpoint === "listing");
  const staticListings = listingChecks.filter((item) => item.listing_analysis?.scrapeable_static);
  const requiresJs = listingChecks.some((item) => item.listing_analysis?.requires_js);

  return {
    target: target.name,
    checks,
    summary: {
      scrapeable_static: staticListings.length > 0,
      requires_js: requiresJs,
      real_listing_count: listingChecks.filter((item) => item.listing_analysis?.content_classification === "real_listing").length,
      recommendation: staticListings.length > 0
        ? "At least one listing exposed parseable static offer rows."
        : "No listing exposed parseable static offer rows in this ad hoc check."
    }
  };
}

async function handleAll(req, res) {
  const results = {};
  for (const [key, target] of Object.entries(targets)) {
    results[key] = await runTargetListingCheck(target);
  }

  sendJson(res, 200, {
    environment: environmentInfo(),
    results
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/" || url.pathname === "/help") {
      sendText(res, 200, [
        "Marketplace access checker",
        "",
        "GET /health",
        "GET /healthz",
        "GET /report",
        "GET /targets",
        "GET /check",
        "GET /check/z2u",
        "GET /check/igv",
        "GET /check/g2a",
        "GET /check/zeusx",
        "",
        "CLI: npm run check"
      ].join("\n"));
      return;
    }

    if (url.pathname === "/health" || url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true, environment: environmentInfo() });
      return;
    }

    if (url.pathname === "/report") {
      sendJson(res, 200, latestReport);
      return;
    }

    if (url.pathname === "/targets") {
      sendJson(res, 200, targets);
      return;
    }

    if (url.pathname === "/check") {
      await handleAll(req, res);
      return;
    }

    const match = url.pathname.match(/^\/check\/([^/]+)$/);
    if (match) {
      await handleCheck(req, res, match[1]);
      return;
    }

    sendJson(res, 404, {
      error: "not_found",
      routes: ["/health", "/healthz", "/report", "/targets", "/check", "/check/z2u", "/check/igv", "/check/g2a", "/check/zeusx"]
    });
  } catch (error) {
    sendJson(res, 500, {
      error: "internal_error",
      message: error.message
    });
  }
});

server.listen(port, host, () => {
  console.log(`Marketplace access checker listening on ${host}:${port}`);

  if (runStartupCheck) {
    runProbeCampaign({ environmentInfo }).catch((error) => {
      console.error("[startup-check:error] " + JSON.stringify({
        name: error.name,
        message: error.message
      }));
    });
  } else {
    console.log("[startup-check] skipped because STARTUP_CHECK=false");
  }
});
