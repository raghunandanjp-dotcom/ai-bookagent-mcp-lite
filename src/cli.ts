#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  acceptBookContent,
  approveCreatureSelection,
  createPromptPackage,
  deliverySummary,
  generateDocuments,
  initializeProject,
  updateCreatureSelection
} from "./workflow.ts";
import { loadProject } from "./project.ts";

function usage(): never {
  console.error(`Usage:
  ai-bookagent init <project-dir> <request.json>
  ai-bookagent select <project-dir> <creatures.json> [--exclude-previous]
  ai-bookagent approve <project-dir>
  ai-bookagent prompt <project-dir>
  ai-bookagent content <project-dir> <content.json>
  ai-bookagent export <project-dir> [docx,pptx,pdf]
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
else if (command === "content" && argument) result = await acceptBookContent(projectDir, await jsonFile(argument));
else if (command === "export") result = await generateDocuments(projectDir, argument?.split(",") as Array<"docx" | "pptx" | "pdf"> | undefined);
else if (command === "summary") result = deliverySummary(await loadProject(projectDir));
else usage();

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
