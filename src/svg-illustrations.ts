import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { z } from "zod";
import { LIMITS, illustrationAssetSchema, illustrationRoleSchema, type BookContent, type IllustrationAsset } from "./domain.ts";
import { inspectIllustration } from "./illustrations.ts";
import { resolveInside } from "./project.ts";

const MAX_SVG_CHARACTERS = 1_000_000;
const allowedTags = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const allowedAttributes = new Set([
  "xmlns", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
  "d", "points", "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "fill-rule", "clip-rule", "opacity", "transform"
]);

const codeNativeAssetSchema = z.object({
  role: illustrationRoleSchema,
  creatureId: z.string().min(1).max(120).optional(),
  svg: z.string().min(1).max(MAX_SVG_CHARACTERS),
  altText: z.string().trim().min(1).max(LIMITS.maxAltTextCharacters),
  createdBy: z.string().trim().min(1).max(200).default("Claude"),
  model: z.string().trim().min(1).max(200).optional(),
  promptDigest: z.string().regex(/^[a-f0-9]{64}$/u).optional()
}).superRefine((value, context) => {
  if (value.role === "cover" && value.creatureId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["creatureId"], message: "Cover artwork cannot target a creature." });
  if (value.role === "creature" && !value.creatureId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["creatureId"], message: "Creature artwork requires creatureId." });
});

export type CodeNativeIllustrationInput = z.input<typeof codeNativeAssetSchema>;

export function sanitizeCodeNativeSvg(svgInput: string): string {
  const svg = svgInput.trim();
  const forbidden = /<!DOCTYPE|<!ENTITY|<\?xml|<script\b|<foreignObject\b|<image\b|<use\b|<style\b|<text\b|<a\b|<iframe\b|\bon[a-z]+\s*=|\b(?:href|xlink:href)\s*=|url\s*\(|@import|javascript:|data:/iu;
  if (forbidden.test(svg)) throw new Error("SVG contains executable, embedded, text, linked, or externally referenced content.");
  if (!/^<svg\b[\s\S]*<\/svg>$/u.test(svg)) throw new Error("SVG must contain exactly one complete <svg> root element.");
  const tags = svg.matchAll(/<\/?([A-Za-z][\w:-]*)(?:\s[^<>]*?)?\/?\s*>/gu);
  let tagCount = 0;
  for (const match of tags) {
    tagCount += 1;
    const tag = match[1]!;
    if (!allowedTags.has(tag)) throw new Error(`SVG element <${tag}> is not allowed.`);
    if (match[0].startsWith("</")) continue;
    const attributeText = match[0].replace(/^<[A-Za-z][\w:-]*/u, "").replace(/\/?>$/u, "");
    for (const attribute of attributeText.matchAll(/([^\s=]+)\s*=\s*(?:"[^"]*"|'[^']*')/gu)) {
      if (!allowedAttributes.has(attribute[1]!)) throw new Error(`SVG attribute ${attribute[1]} is not allowed.`);
    }
    const residue = attributeText.replace(/([^\s=]+)\s*=\s*(?:"[^"]*"|'[^']*')/gu, "").trim();
    if (residue) throw new Error("SVG attributes must be quoted and use the supported allowlist.");
  }
  if (tagCount < 2) throw new Error("SVG must include at least one visible shape.");
  if (!/\bviewBox\s*=\s*["']\s*0\s+0\s+[1-9][\d.]*\s+[1-9][\d.]*\s*["']/u.test(svg)) {
    throw new Error("SVG root must declare a positive viewBox beginning at 0 0.");
  }
  return svg;
}

function assetId(role: "cover" | "creature", creatureId?: string): string {
  return role === "cover" ? "cover" : `creature-${creatureId}`;
}

async function writeAtomic(destination: string, data: string | Buffer): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const buffer = typeof data === "string" ? Buffer.from(data) : data;
  try {
    const existing = await readFile(destination);
    if (existing.equals(buffer)) return;
    throw new Error(`Code-native illustration destination collision: ${destination}.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await writeFile(temporary, buffer, { flag: "wx" });
  await rename(temporary, destination);
}

export async function importCodeNativeIllustrationSet(
  projectDir: string,
  content: BookContent,
  input: unknown
): Promise<IllustrationAsset[]> {
  const parsed = z.array(codeNativeAssetSchema).parse(input);
  const requiredIds = ["cover", ...content.creatures.map((creature) => `creature-${creature.creatureId}`)];
  const suppliedIds = parsed.map((item) => assetId(item.role, item.creatureId));
  const duplicates = suppliedIds.filter((id, index) => suppliedIds.indexOf(id) !== index);
  const missing = requiredIds.filter((id) => !suppliedIds.includes(id));
  const unexpected = suppliedIds.filter((id) => !requiredIds.includes(id));
  if (duplicates.length || missing.length || unexpected.length) {
    throw new Error(`Code-native illustration set must exactly match the required slots. Missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}; duplicates: ${[...new Set(duplicates)].join(", ") || "none"}.`);
  }

  const importedAt = new Date().toISOString();
  const assets: IllustrationAsset[] = [];
  for (const item of parsed) {
    const id = assetId(item.role, item.creatureId);
    const svg = sanitizeCodeNativeSvg(item.svg);
    const svgBytes = Buffer.from(`${svg}\n`, "utf8");
    const svgDigest = createHash("sha256").update(svgBytes).digest("hex");
    const png = Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: 1600 } }).render().asPng());
    const inspected = inspectIllustration(png);
    const pngDigest = createHash("sha256").update(png).digest("hex");
    const svgRelativePath = path.posix.join("assets", "illustrations", "source", `${id}-${svgDigest.slice(0, 12)}.svg`);
    const pngRelativePath = path.posix.join("assets", "illustrations", `${id}-${pngDigest.slice(0, 12)}.png`);
    await writeAtomic(resolveInside(projectDir, svgRelativePath), svgBytes);
    await writeAtomic(resolveInside(projectDir, pngRelativePath), png);
    assets.push(illustrationAssetSchema.parse({
      assetId: id,
      role: item.role,
      creatureId: item.creatureId,
      approvalStatus: "pending_review",
      relativePath: pngRelativePath,
      mimeType: inspected.mimeType,
      width: inspected.width,
      height: inspected.height,
      bytes: png.byteLength,
      sha256: pngDigest,
      altText: item.altText,
      source: "code_native",
      provenance: {
        importedAt,
        createdBy: item.createdBy,
        generator: "Claude-authored constrained SVG; locally rasterized with resvg",
        model: item.model,
        promptDigest: item.promptDigest,
        notes: `Sanitized SVG source: ${svgRelativePath}; SVG SHA-256: ${svgDigest}`
      },
      license: {
        name: "Project-authored code-native illustration",
        usageNotes: "Created for this book project from constrained SVG markup and rasterized locally."
      }
    }));
  }
  return assets;
}
