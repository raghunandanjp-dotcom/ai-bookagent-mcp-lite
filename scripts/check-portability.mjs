import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ignored = new Set([".git", "node_modules", "dist", "output", "outputs", "work", "coverage"]);
const extensions = new Set([".ts", ".js", ".mjs", ".json", ".md", ".example", ".yml", ".yaml"]);
const forbidden = [
  /[A-Za-z]:\\Users\\/i,
  /\/Users\/[^/\s]+/i,
  /\/home\/[^/\s]+/i,
  /file:\/\//i
];

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await files(full));
    else if (extensions.has(path.extname(entry.name)) || entry.name === ".env.example") results.push(full);
  }
  return results;
}

const violations = [];
for (const file of await files(root)) {
  const content = await readFile(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(content)) violations.push(`${path.relative(root, file)} matches ${pattern}`);
  }
}
if (violations.length) {
  console.error(`Portability check failed:\n${violations.join("\n")}`);
  process.exit(1);
}
console.log("Portability check passed: no user-specific absolute paths found.");
