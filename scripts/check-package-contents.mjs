import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const npmExecPath = process.env.npm_execpath ?? (process.platform === "win32" ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js") : undefined);
const npmCommand = npmExecPath ? process.execPath : "npm";
const npmArgs = npmExecPath ? [npmExecPath] : [];
const npmCache = process.env.AI_BOOKAGENT_NPM_CACHE ?? path.join(os.tmpdir(), "ai-bookagent-npm-cache");
const result = spawnSync(npmCommand, [...npmArgs, "pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, npm_config_cache: npmCache, npm_config_update_notifier: "false" }
});

if (result.status !== 0) {
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(result.error);
  process.exit(result.status ?? 1);
}

let report;
try {
  [report] = JSON.parse(result.stdout);
} catch {
  console.error(`Could not parse npm pack output:\n${result.stdout}`);
  process.exit(1);
}

const paths = report.files.map((file) => file.path);
const required = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/server.js",
  "dist/cli.js",
  "assets/fonts/NotoSans-Regular.ttf",
  "assets/fonts/NotoSans-Bold.ttf",
  "assets/fonts/OFL.txt"
];
const unexpected = paths.filter((file) => ![
  "package.json",
  "README.md",
  "LICENSE"
].includes(file) && !file.startsWith("dist/") && !file.startsWith("assets/fonts/"));
const forbidden = paths.filter((file) => /(^|\/)(?:\.claude-tests|tests?|src|scripts|docs|examples|output|work|coverage|\.pptx-qa|\.pdf-qa|\.docx-qa)(?:\/|$)/u.test(file));
const missing = required.filter((file) => !paths.includes(file));

if (unexpected.length > 0 || forbidden.length > 0 || missing.length > 0) {
  if (missing.length > 0) console.error(`Missing package files:\n${missing.join("\n")}`);
  if (unexpected.length > 0) console.error(`Unexpected package files:\n${unexpected.join("\n")}`);
  if (forbidden.length > 0) console.error(`Forbidden package files:\n${forbidden.join("\n")}`);
  process.exit(1);
}

console.log(`Package contents check passed: ${paths.length} files, ${report.unpackedSize} unpacked bytes.`);
