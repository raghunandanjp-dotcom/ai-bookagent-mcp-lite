import { access } from "node:fs/promises";

const requiredEntrypoints = [
  "dist/server.js",
  "dist/cli.js"
];

const missing = [];

for (const entrypoint of requiredEntrypoints) {
  try {
    await access(entrypoint);
  } catch {
    missing.push(entrypoint);
  }
}

if (missing.length > 0) {
  console.error(`Missing build entrypoints:\n${missing.join("\n")}`);
  process.exit(1);
}

console.log(`Entrypoint check passed: ${requiredEntrypoints.join(", ")}`);
