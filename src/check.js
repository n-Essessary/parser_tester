import { runHttpDiagnostic } from "./httpDiagnostic.js";
import { targets } from "./targets.js";

const selected = process.argv.slice(2);
const entries = selected.length
  ? selected.map((key) => [key, targets[key]]).filter(([, target]) => target)
  : Object.entries(targets);

if (entries.length === 0) {
  console.error(`No valid targets selected. Available: ${Object.keys(targets).join(", ")}`);
  process.exit(1);
}

const results = [];
for (const [key, target] of entries) {
  const checks = [
    await runHttpDiagnostic(target, { endpoint: "home", url: target.url }),
    await runHttpDiagnostic(target, { endpoint: "listing", url: target.listingUrl ?? target.url })
  ];

  const kill_switch_triggered = checks.some((item) => item.kill_switch?.triggered !== false);
  const can_continue = checks.every((item) => item.kill_switch?.can_continue === true);

  results.push({
    key,
    target: target.name,
    checks,
    summary: {
      kill_switch_triggered,
      can_continue,
      recommendation: can_continue
        ? "Pass. Continue to scrape."
        : "Fail. Cloudflare/ASN block likely; use residential proxy or partner route."
    }
  });
}

console.log(JSON.stringify({
  environment: {
    node: process.version,
    platform: process.platform,
    coolify: Boolean(process.env.COOLIFY_URL || process.env.COOLIFY_FQDN || process.env.COOLIFY_BRANCH),
    coolify_url: process.env.COOLIFY_URL ?? null,
    coolify_fqdn: process.env.COOLIFY_FQDN ?? null,
    railway: Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID),
    railway_environment: process.env.RAILWAY_ENVIRONMENT ?? null,
    service: process.env.RAILWAY_SERVICE_NAME ?? null
  },
  results
}, null, 2));
