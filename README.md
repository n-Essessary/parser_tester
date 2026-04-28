# Railway Marketplace Access Checker

Small Railway-ready service for checking whether marketplace pages can be reached for future parsing.

Targets:

- Eldorado WoW Classic Gold
- Z2U WoW Classic TBC Gold

## Local Run

```bash
npm start
```

Open:

- `http://localhost:3000/health`
- `http://localhost:3000/check`
- `http://localhost:3000/check/eldorado`
- `http://localhost:3000/check/z2u`

CLI check:

```bash
npm run check
```

## Railway Deploy

1. Create a new Railway project.
2. Connect this repository or upload the project.
3. Railway should detect Node.js through Nixpacks.
4. Deploy.
5. Open the public Railway URL and call `/check`.

The service uses `process.env.PORT`, so Railway can assign the port automatically.

## Reading Results

Important response fields:

- `status`: HTTP status returned by the target.
- `final_url`: final URL after redirects.
- `response_headers`: selected headers useful for detecting protection layers.
- `detection.blocked_likely`: high-level anti-bot/blocking signal.
- `detection.direct_http_promising`: whether simple HTTP parsing looks realistic.
- `detection.signals`: individual checks for Cloudflare, captcha, access denied, rate limit, JS-required pages, and common bot protection systems.
- `body.title`, `body.snippet`: safe preview of returned content.
- `extraction_hints`: script and API-like strings found in HTML.
- `verdict`: compact conclusion.

Typical verdicts:

- `direct_http_access_ok`: direct HTTP parsing likely works.
- `html_access_ok_needs_data_source_analysis`: page opens, but useful data may be loaded by JavaScript/API.
- `blocked_or_challenged`: target likely blocks or challenges this environment.
- `http_error`: target returned a 4xx/5xx status.
- `timeout`: target did not respond in time.
- `network_or_tls_error`: DNS, TLS, or network-level failure.

## Environment Variables

- `PORT`: server port. Railway sets this automatically.
- `REQUEST_TIMEOUT_MS`: request timeout, default `25000`.
- `MAX_BODY_BYTES`: max response bytes read per target, default `1500000`.
- `USER_AGENT`: override the browser-like user agent.
- `HOST`: bind host, default `0.0.0.0`. For local sandboxed runs, use `127.0.0.1`.

## Notes

This project intentionally starts with direct HTTP diagnostics because it is cheap and reliable on Railway. If results show JavaScript-only content but no hard block, the next step is to add a Playwright-based check and compare browser-rendered content against the HTTP result.
