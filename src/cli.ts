#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  acceptBookContent,
  acceptPrimaryOutput,
  approveBookDesign,
  approveCreatureSelection,
  createPromptPackage,
  createIllustrationPromptPackage,
  createBookDesignPreview,
  deliverySummary,
  generateDocuments,
  initializeProject,
  importProjectIllustration,
  importProjectCodeNativeIllustrationSet,
  reworkPrimaryOutput,
  reviewProjectIllustration,
  updateCreatureSelection
} from "./workflow.ts";
import { loadProject } from "./project.ts";
import { NativeCredentialVault, canvaConnectStatus, configureCanvaConnect, consentToLocalCanvaImport, importApprovedCanvaPptx, promptHidden } from "./canva-connect.ts";

function usage(): never {
  console.error(`Usage:
  ai-bookagent init <project-dir> <request.json>
  ai-bookagent select <project-dir> <creatures.json> [--exclude-previous]
  ai-bookagent approve <project-dir>
  ai-bookagent prompt <project-dir>
  ai-bookagent illustration-prompts <project-dir>
  ai-bookagent import-illustration <project-dir> <asset.json>
  ai-bookagent import-svg-set <project-dir> <assets.json>
  ai-bookagent design-preview <project-dir>
  ai-bookagent approve-design <project-dir> <review.json>
  ai-bookagent review-illustration <project-dir> <review.json>
  ai-bookagent content <project-dir> <content.json>
  ai-bookagent export <project-dir> [docx,pptx,pdf]
  ai-bookagent accept-docx <project-dir>
  ai-bookagent rework <project-dir> <content.json>
  ai-bookagent summary <project-dir>
  ai-bookagent canva configure
  ai-bookagent canva status
  ai-bookagent canva disconnect
  ai-bookagent canva consent <project-dir>
  ai-bookagent canva import <project-dir>`);
  process.exit(2);
}

async function jsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
}

const [, , command, projectDir, argument, flag] = process.argv;
if (!command || !projectDir) usage();

if (command === "canva") {
  const vault = new NativeCredentialVault();
  let canvaResult: unknown;
  if (projectDir === "configure") {
    const clientId = await promptHidden("Canva client ID: ");
    const clientSecret = await promptHidden("Canva client secret (hidden): ");
    await configureCanvaConnect(vault, clientId, clientSecret);
    canvaResult = { configured: true };
  } else if (projectDir === "status") canvaResult = await canvaConnectStatus(vault);
  else if (projectDir === "disconnect") { await vault.remove(); canvaResult = { disconnected: true }; }
  else if (projectDir === "consent" && argument) canvaResult = await consentToLocalCanvaImport(path.resolve(argument));
  else if (projectDir === "import" && argument) canvaResult = await importApprovedCanvaPptx(path.resolve(argument), vault);
  else usage();
  process.stdout.write(`${JSON.stringify(canvaResult, null, 2)}\n`);
  process.exit(0);
}
const absoluteProjectDir = path.resolve(projectDir);

let result: unknown;
if (command === "init" && argument) result = await initializeProject(absoluteProjectDir, await jsonFile(argument));
else if (command === "select" && argument) result = await updateCreatureSelection(absoluteProjectDir, await jsonFile(argument), flag === "--exclude-previous");
else if (command === "approve") result = await approveCreatureSelection(absoluteProjectDir);
else if (command === "prompt") result = await createPromptPackage(absoluteProjectDir);
else if (command === "illustration-prompts") result = await createIllustrationPromptPackage(absoluteProjectDir);
else if (command === "import-illustration" && argument) result = await importProjectIllustration(absoluteProjectDir, await jsonFile(argument));
else if (command === "import-svg-set" && argument) result = await importProjectCodeNativeIllustrationSet(absoluteProjectDir, await jsonFile(argument));
else if (command === "design-preview") result = await createBookDesignPreview(absoluteProjectDir);
else if (command === "approve-design" && argument) {
  const review = await jsonFile(argument) as { reviewedBy: string; note?: string };
  result = await approveBookDesign(absoluteProjectDir, review.reviewedBy, review.note);
}
else if (command === "review-illustration" && argument) {
  const review = await jsonFile(argument) as { assetId: string; approved: boolean; reviewedBy: string; note?: string };
  result = await reviewProjectIllustration(absoluteProjectDir, review.assetId, review.approved, review.reviewedBy, review.note);
}
else if (command === "content" && argument) result = await acceptBookContent(absoluteProjectDir, await jsonFile(argument));
else if (command === "export") result = await generateDocuments(absoluteProjectDir, argument?.split(",") as Array<"docx" | "pptx" | "pdf"> | undefined);
else if (command === "accept-docx") result = await acceptPrimaryOutput(absoluteProjectDir);
else if (command === "rework" && argument) result = await reworkPrimaryOutput(absoluteProjectDir, await jsonFile(argument));
else if (command === "summary") result = deliverySummary(await loadProject(absoluteProjectDir));
else usage();

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
