# Coolify Marketplace Kill-Switch Checker

Small Coolify-ready service for pre-checking marketplace accessibility before parsing.

Targets:

- Z2U
- IGV
- G2A
- ZeusX

## Local Run

```bash
npm start
```

Open:

- `http://localhost:3000/health`
- `http://localhost:3000/check`
- `http://localhost:3000/check/z2u`
- `http://localhost:3000/check/igv`
- `http://localhost:3000/check/g2a`
- `http://localhost:3000/check/zeusx`

CLI check:

```bash
npm run check
```

## Coolify Deploy

1. Create a new Coolify application from this repository.
2. Connect this repository or upload the project.
3. Set Build Pack to Node.js/Nixpacks (auto-detected in most setups).
4. Start command: `npm start`.
5. Deploy.
6. Open your public Coolify URL and call `/check`.

On every container start, the app writes startup kill-switch diagnostics to logs. Look for lines beginning with `startup-check`.

The service uses `process.env.PORT`, so Coolify can assign the port automatically.

## Reading Results

Important response fields:

- `checks`: two probes per target (`home` and `listing`).
- `checks[].status`: HTTP status returned by the probe URL.
- `checks[].response_headers`: selected headers useful for Cloudflare detection (`cf-ray`, `cf-mitigated`, etc).
- `checks[].kill_switch`: pass/fail gate for parser launch.
- `checks[].kill_switch.reason`: `cloudflare_or_asn_block`, `edge_waf_or_asn_block`, `http_ok_normal_body`, or fallback reason.
- `summary.kill_switch_triggered`: `true` if any probe fails kill-switch criteria.
- `summary.can_continue`: `true` only when both probes pass (200 + normal body).

Kill-switch logic:

- `403` / `503` / `cf-mitigated: challenge` => blocked by Cloudflare or edge WAF/datacenter ASN. Use residential proxy or partner route.
- `200` + normal HTML body => pass, can continue to deeper parsing checks.

## Environment Variables

- `PORT`: server port. Coolify sets this automatically.
- `REQUEST_TIMEOUT_MS`: request timeout, default `25000`.
- `MAX_BODY_BYTES`: max response bytes read per target, default `1500000`.
- `USER_AGENT`: override the browser-like user agent.
- `HOST`: bind host, default `0.0.0.0`. For local sandboxed runs, use `127.0.0.1`.
- `STARTUP_CHECK`: run diagnostics when the server starts, default `true`. Set to `false` to disable startup log checks.

## Notes

This project is focused on cheap, fast HTTP kill-switch diagnostics. If a target passes here but parsing still fails, the next step is browser-based verification (Playwright) and proxy routing strategy.
