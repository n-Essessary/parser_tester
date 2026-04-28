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
  const result = await runHttpDiagnostic(target);
  results.push({ key, ...result });
}

console.log(JSON.stringify({
  environment: {
    node: process.version,
    platform: process.platform,
    railway: Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID),
    railway_environment: process.env.RAILWAY_ENVIRONMENT ?? null,
    service: process.env.RAILWAY_SERVICE_NAME ?? null
  },
  results
}, null, 2));
