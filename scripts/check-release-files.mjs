import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "dist/server.js",
  "dist/cli.js",
  "assets/fonts/NotoSans-Regular.ttf",
  "assets/fonts/NotoSans-Bold.ttf",
  "assets/fonts/OFL.txt",
  "LICENSE"
];

const missing = [];
for (const file of requiredFiles) {
  try {
    await access(file);
  } catch {
    missing.push(file);
  }
}

if (missing.length > 0) {
  console.error(`Release validation failed; required files are missing:\n${missing.join("\n")}`);
  process.exit(1);
}

for (const entrypoint of ["dist/server.js", "dist/cli.js"]) {
  const source = await readFile(entrypoint, "utf8");
  if (!source.startsWith("#!/usr/bin/env node")) {
    console.error(`Release validation failed; ${entrypoint} is missing its Node.js shebang.`);
    process.exit(1);
  }
}

console.log(`Release file check passed: ${requiredFiles.join(", ")}`);
