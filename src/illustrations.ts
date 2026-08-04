import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  LIMITS,
  illustrationAssetSchema,
  illustrationRoleSchema,
  type BookContent,
  type BookRequest,
  type IllustrationAsset
} from "./domain.ts";
import { resolveInside } from "./project.ts";

const importIllustrationSchema = z.object({
  role: illustrationRoleSchema,
  creatureId: z.string().min(1).max(120).optional(),
  sourcePath: z.string().min(1),
  altText: z.string().trim().min(1).max(LIMITS.maxAltTextCharacters),
  source: z.enum(["host_generated", "user_supplied"]),
  provenance: z.object({
    createdBy: z.string().trim().min(1).max(200).optional(),
    generator: z.string().trim().min(1).max(200).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    sourceUri: z.string().url().optional(),
    promptDigest: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
    notes: z.string().trim().min(1).max(1_000).optional()
  }).default({}),
  license: z.object({
    name: z.string().trim().min(1).max(200),
    url: z.string().url().optional(),
    attribution: z.string().trim().min(1).max(500).optional(),
    usageNotes: z.string().trim().min(1).max(1_000).optional()
  })
}).superRefine((value, context) => {
  if (value.role === "cover" && value.creatureId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["creatureId"], message: "Cover artwork cannot target a creature." });
  if (value.role === "creature" && !value.creatureId) context.addIssue({ code: z.ZodIssueCode.custom, path: ["creatureId"], message: "Creature artwork requires creatureId." });
});

export type IllustrationImport = z.input<typeof importIllustrationSchema>;

function inspectPng(data: Buffer) {
  if (data.length < 24 || data.toString("hex", 0, 8) !== "89504e470d0a1a0a") return undefined;
  return { mimeType: "image/png" as const, extension: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function inspectJpeg(data: Buffer) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) { offset += 1; continue; }
    const marker = data[offset + 1]!;
    if (marker === 0xd9 || marker === 0xda) break;
    const length = data.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > data.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { mimeType: "image/jpeg" as const, extension: "jpg", height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return undefined;
}

export function inspectIllustration(data: Buffer) {
  if (data.byteLength > LIMITS.maxIllustrationBytes) throw new Error(`Illustration exceeds the ${LIMITS.maxIllustrationBytes} byte limit.`);
  const details = inspectPng(data) ?? inspectJpeg(data);
  if (!details || details.width < 1 || details.height < 1) throw new Error("Illustration must be a valid PNG or JPEG image.");
  if (details.width > LIMITS.maxIllustrationDimension || details.height > LIMITS.maxIllustrationDimension) {
    throw new Error(`Illustration dimensions must not exceed ${LIMITS.maxIllustrationDimension} pixels.`);
  }
  if (Math.max(details.width, details.height) < LIMITS.minIllustrationLongEdge || Math.min(details.width, details.height) < LIMITS.minIllustrationShortEdge) {
    throw new Error(`Illustration must be at least ${LIMITS.minIllustrationLongEdge}px on its long edge and ${LIMITS.minIllustrationShortEdge}px on its short edge for print-quality fitting.`);
  }
  return details;
}

function slotId(role: "cover" | "creature", creatureId?: string): string {
  return role === "cover" ? "cover" : `creature-${creatureId}`;
}

export async function importIllustration(projectDir: string, input: unknown): Promise<IllustrationAsset> {
  const parsed = importIllustrationSchema.parse(input);
  const data = await readFile(path.resolve(parsed.sourcePath));
  const inspected = inspectIllustration(data);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const assetId = slotId(parsed.role, parsed.creatureId);
  const relativePath = path.posix.join("assets", "illustrations", `${assetId}-${sha256.slice(0, 12)}.${inspected.extension}`);
  const destination = resolveInside(projectDir, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    const existing = await readFile(destination);
    if (!existing.equals(data)) throw new Error(`Illustration destination collision for ${relativePath}.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, destination);
  }
  return illustrationAssetSchema.parse({
    assetId,
    role: parsed.role,
    creatureId: parsed.creatureId,
    approvalStatus: "pending_review",
    relativePath,
    mimeType: inspected.mimeType,
    width: inspected.width,
    height: inspected.height,
    bytes: data.byteLength,
    sha256,
    altText: parsed.altText,
    source: parsed.source,
    provenance: { ...parsed.provenance, importedAt: new Date().toISOString() },
    license: parsed.license
  });
}

export interface ResolvedIllustrationAsset extends IllustrationAsset {
  absolutePath: string;
}

export interface ApprovedIllustrationSet {
  cover: ResolvedIllustrationAsset;
  creatures: Map<string, ResolvedIllustrationAsset>;
}

export class IllustrationValidationError extends Error {
  readonly code = "illustration_validation_failed";
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Illustration validation failed:\n- ${issues.join("\n- ")}`);
    this.name = "IllustrationValidationError";
    this.issues = issues;
  }
}

export async function resolveApprovedIllustrations(
  projectDir: string,
  content: BookContent,
  assets: IllustrationAsset[]
): Promise<ApprovedIllustrationSet> {
  const required: Array<{ role: "cover" | "creature"; creatureId?: string }> = [
    { role: "cover" },
    ...content.creatures.map((creature) => ({ role: "creature" as const, creatureId: creature.creatureId }))
  ];
  const errors: string[] = [];
  const resolved = new Map<string, ResolvedIllustrationAsset>();
  for (const slot of required) {
    const id = slotId(slot.role, slot.creatureId);
    const matches = assets.filter((asset) => asset.assetId === id);
    if (matches.length !== 1) { errors.push(`${id}: expected exactly one illustration asset.`); continue; }
    const asset = illustrationAssetSchema.parse(matches[0]);
    if (asset.approvalStatus !== "approved") { errors.push(`${id}: illustration must be approved before export.`); continue; }
    const absolutePath = resolveInside(projectDir, asset.relativePath);
    try {
      const data = await readFile(absolutePath);
      const inspected = inspectIllustration(data);
      const digest = createHash("sha256").update(data).digest("hex");
      if (digest !== asset.sha256) errors.push(`${id}: stored illustration digest does not match the approved asset.`);
      if (data.byteLength !== asset.bytes) errors.push(`${id}: stored illustration byte count does not match the approved asset.`);
      if (inspected.mimeType !== asset.mimeType || inspected.width !== asset.width || inspected.height !== asset.height) errors.push(`${id}: stored illustration metadata does not match the approved asset.`);
      resolved.set(id, { ...asset, absolutePath });
    } catch (error) {
      errors.push(`${id}: illustration is missing, unreadable, or corrupt (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
  const unexpected = assets.filter((asset) => !required.some((slot) => slotId(slot.role, slot.creatureId) === asset.assetId));
  if (unexpected.length > 0) errors.push(`Unexpected illustration slots: ${unexpected.map((asset) => asset.assetId).join(", ")}.`);
  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  if (totalBytes > LIMITS.maxIllustrationSetBytes) errors.push(`Approved illustration set exceeds the ${LIMITS.maxIllustrationSetBytes} byte limit.`);
  if (errors.length > 0) throw new IllustrationValidationError(errors);
  return {
    cover: resolved.get("cover")!,
    creatures: new Map(content.creatures.map((creature) => [creature.creatureId, resolved.get(slotId("creature", creature.creatureId))!]))
  };
}

export function prepareIllustrationPrompts(request: BookRequest, content: BookContent) {
  const artDirection = `Create a cohesive children's book illustration set for ${request.title}. Maintain the same palette, rendering style, lighting, character proportions, and age-appropriate tone across every asset. Do not include typography, captions, borders, watermarks, or UI elements.`;
  const coverPrompt = `${artDirection} Cover scene: introduce the ${request.theme} world and include recognizable appearances of the selected creatures without crowding. Leave calm visual space for a separately editable book title.`;
  return {
    promptPackageVersion: "1.0",
    assetCount: 1 + content.creatures.length,
    artDirection,
    assets: [
      { assetId: "cover", role: "cover", prompt: coverPrompt, promptDigest: createHash("sha256").update(coverPrompt).digest("hex") },
      ...content.creatures.map((creature) => {
        const prompt = `${artDirection} Creature asset for ${creature.displayName}: ${creature.illustrationBrief}`;
        return { assetId: slotId("creature", creature.creatureId), role: "creature", creatureId: creature.creatureId, prompt, promptDigest: createHash("sha256").update(prompt).digest("hex"), suggestedAltText: creature.altText };
      })
    ],
    workflow: "Generate each asset with a host-provided image tool or supply an existing image, import it into the project, review it, and explicitly approve it. No paid image API is required by this connector."
  };
}
