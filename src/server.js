import http from "node:http";
import { runHttpDiagnostic } from "./httpDiagnostic.js";
import { getTarget, targets } from "./targets.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

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

  const result = await runHttpDiagnostic(target);
  sendJson(res, 200, {
    environment: environmentInfo(),
    key: targetKey,
    ...result
  });
}

async function handleAll(req, res) {
  const results = {};
  for (const [key, target] of Object.entries(targets)) {
    results[key] = await runHttpDiagnostic(target);
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
        "GET /targets",
        "GET /check",
        "GET /check/eldorado",
        "GET /check/z2u",
        "",
        "CLI: npm run check"
      ].join("\n"));
      return;
    }

    if (url.pathname === "/health") {
      sendJson(res, 200, { ok: true, environment: environmentInfo() });
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
      routes: ["/health", "/targets", "/check", "/check/eldorado", "/check/z2u"]
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
});
