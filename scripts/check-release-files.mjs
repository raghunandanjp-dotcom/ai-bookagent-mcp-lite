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

const changelog = await readFile("CHANGELOG.md", "utf8");
const requiredChangelogText = [
  "## [0.1.0]",
  "### Known limitations",
  "Experimental Kannada content requires fluent human language and rendered-glyph review.",
  "Live Canva connector and handoff were intentionally skipped and remain unqualified.",
  "npm publication is not part of the approved GitHub-only launch."
];
const obsoleteChangelogText = [
  "### Known release gates",
  "DOCX and PPTX visual rendering awaits LibreOffice-backed RC evidence.",
  "English current-baseline Claude content/design/export review is pending; the visible `cld-eng-04` run stops at `content_review_required`.",
  "npm publication, GitHub public visibility, tag, and GitHub release do not yet exist and require explicit maintainer approval."
];
const missingChangelogText = requiredChangelogText.filter((text) => !changelog.includes(text));
const obsoleteChangelogHeadings = (changelog.match(/^## .+$/gmu) ?? []).filter((heading) => /\b(?:rc|unreleased)\b/iu.test(heading));
const presentObsoleteChangelogText = [
  ...obsoleteChangelogHeadings,
  ...obsoleteChangelogText.filter((text) => changelog.includes(text))
];

if (missingChangelogText.length > 0 || presentObsoleteChangelogText.length > 0) {
  if (missingChangelogText.length > 0) {
    console.error(`Release validation failed; CHANGELOG.md is missing required release metadata:\n${missingChangelogText.join("\n")}`);
  }
  if (presentObsoleteChangelogText.length > 0) {
    console.error(`Release validation failed; CHANGELOG.md contains obsolete release metadata:\n${presentObsoleteChangelogText.join("\n")}`);
  }
  process.exit(1);
}

console.log(`Release file check passed: ${requiredFiles.join(", ")}`);
