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
    await runHttpDiagnostic(target, { endpoint: "home", url: target.url })
  ];
  for (const url of target.listingUrls) {
    checks.push(await runHttpDiagnostic(target, { endpoint: "listing", url }));
  }

  const listingChecks = checks.filter((item) => item.endpoint === "listing");
  const staticListings = listingChecks.filter((item) => item.listing_analysis?.scrapeable_static);

  results.push({
    key,
    target: target.name,
    checks,
    summary: {
      scrapeable_static: staticListings.length > 0,
      requires_js: listingChecks.some((item) => item.listing_analysis?.requires_js),
      real_listing_count: listingChecks.filter((item) => item.listing_analysis?.content_classification === "real_listing").length,
      recommendation: staticListings.length > 0
        ? "Pass. At least one listing exposes parseable static offer rows."
        : "Fail/conditional. No listing exposed parseable static offer rows in this CLI check."
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
