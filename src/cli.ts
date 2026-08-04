#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  acceptBookContent,
  acceptPrimaryOutput,
  approveCreatureSelection,
  createPromptPackage,
  createIllustrationPromptPackage,
  deliverySummary,
  generateDocuments,
  initializeProject,
  importProjectIllustration,
  reworkPrimaryOutput,
  reviewProjectIllustration,
  updateCreatureSelection
} from "./workflow.ts";
import { loadProject } from "./project.ts";

function usage(): never {
  console.error(`Usage:
  ai-bookagent init <project-dir> <request.json>
  ai-bookagent select <project-dir> <creatures.json> [--exclude-previous]
  ai-bookagent approve <project-dir>
  ai-bookagent prompt <project-dir>
  ai-bookagent illustration-prompts <project-dir>
  ai-bookagent import-illustration <project-dir> <asset.json>
  ai-bookagent review-illustration <project-dir> <review.json>
  ai-bookagent content <project-dir> <content.json>
  ai-bookagent export <project-dir> [docx,pptx,pdf]
  ai-bookagent accept-docx <project-dir>
  ai-bookagent rework <project-dir> <content.json>
  ai-bookagent summary <project-dir>`);
  process.exit(2);
}

async function jsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
}

const [, , command, projectDir, argument, flag] = process.argv;
if (!command || !projectDir) usage();

let result: unknown;
if (command === "init" && argument) result = await initializeProject(projectDir, await jsonFile(argument));
else if (command === "select" && argument) result = await updateCreatureSelection(projectDir, await jsonFile(argument), flag === "--exclude-previous");
else if (command === "approve") result = await approveCreatureSelection(projectDir);
else if (command === "prompt") result = await createPromptPackage(projectDir);
else if (command === "illustration-prompts") result = await createIllustrationPromptPackage(projectDir);
else if (command === "import-illustration" && argument) result = await importProjectIllustration(projectDir, await jsonFile(argument));
else if (command === "review-illustration" && argument) {
  const review = await jsonFile(argument) as { assetId: string; approved: boolean; reviewedBy: string; note?: string };
  result = await reviewProjectIllustration(projectDir, review.assetId, review.approved, review.reviewedBy, review.note);
}
else if (command === "content" && argument) result = await acceptBookContent(projectDir, await jsonFile(argument));
else if (command === "export") result = await generateDocuments(projectDir, argument?.split(",") as Array<"docx" | "pptx" | "pdf"> | undefined);
else if (command === "accept-docx") result = await acceptPrimaryOutput(projectDir);
else if (command === "rework" && argument) result = await reworkPrimaryOutput(projectDir, await jsonFile(argument));
else if (command === "summary") result = deliverySummary(await loadProject(projectDir));
else usage();

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
