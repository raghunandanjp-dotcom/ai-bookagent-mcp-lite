import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizePoemText } from "./poems.ts";
import type { BookContent, IllustrationAsset } from "./domain.ts";

const hexColorSchema = z.string().regex(/^#[0-9A-F]{6}$/u);
const designStatusSchema = z.enum(["ready_for_review", "approved"]);

const designThemeSchema = z.object({
  name: z.string().min(1).max(100),
  colors: z.object({
    primary: hexColorSchema,
    secondary: hexColorSchema,
    accent: hexColorSchema,
    background: hexColorSchema,
    surface: hexColorSchema,
    text: hexColorSchema
  }),
  headingFont: z.enum(["Noto Sans", "Noto Sans Kannada"]),
  bodyFont: z.enum(["Noto Sans", "Noto Sans Kannada"]),
  cornerRadius: z.number().min(0).max(48)
});

const basePageSchema = z.object({
  pageId: z.string().min(1).max(180),
  illustrationAssetId: z.string().min(1).max(160).optional(),
  layout: z.enum(["cover", "illustration-top", "closing"])
});

const coverPageSchema = basePageSchema.extend({
  type: z.literal("cover"),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  illustrationAssetId: z.literal("cover"),
  layout: z.literal("cover")
});

const sectionPageSchema = basePageSchema.extend({
  type: z.enum(["poem", "funFact", "activity"]),
  creatureId: z.string().min(1),
  creature: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  poemTitle: z.string().min(1).optional(),
  illustrationAssetId: z.string().min(1),
  layout: z.literal("illustration-top")
});

const closingPageSchema = basePageSchema.extend({
  type: z.literal("closing"),
  title: z.string().min(1),
  body: z.string().min(1),
  layout: z.literal("closing")
});

export const bookDesignSchema = z.object({
  designVersion: z.literal("1.0"),
  language: z.enum(["en", "kn"]),
  designRevision: z.number().int().positive(),
  sourceRevision: z.number().int().positive(),
  illustrationSetDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  status: designStatusSchema,
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().optional(),
  approvedBy: z.string().min(1).max(200).optional(),
  approvalNote: z.string().min(1).max(1_000).optional(),
  theme: designThemeSchema,
  formatProfiles: z.object({
    document: z.object({ size: z.literal("A4"), orientation: z.literal("portrait") }),
    presentation: z.object({ size: z.literal("LAYOUT_WIDE"), orientation: z.literal("landscape") })
  }),
  pages: z.array(z.union([coverPageSchema, sectionPageSchema, closingPageSchema])).min(4).max(100),
  formatExceptions: z.array(z.object({ format: z.enum(["html", "docx", "pptx", "pdf", "canva"]), message: z.string().min(1) })).default([])
}).superRefine((design, context) => {
  if (design.status === "approved" && (!design.approvedAt || !design.approvedBy)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "Approved design requires approval time and reviewer." });
  }
  const pageIds = new Set<string>();
  for (const [index, page] of design.pages.entries()) {
    if (pageIds.has(page.pageId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["pages", index, "pageId"], message: "Design page IDs must be unique." });
    pageIds.add(page.pageId);
  }
});

export type BookDesign = z.infer<typeof bookDesignSchema>;
export type DesignPage = BookDesign["pages"][number];

export function illustrationSetDigest(assets: IllustrationAsset[]): string {
  const canonical = [...assets]
    .sort((left, right) => left.assetId.localeCompare(right.assetId))
    .map((asset) => `${asset.assetId}:${asset.sha256}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildBookDesign(
  content: BookContent,
  assets: IllustrationAsset[],
  sourceRevision: number,
  designRevision: number,
  createdAt = new Date().toISOString()
): BookDesign {
  const headingFont = content.language === "kn" ? "Noto Sans Kannada" : "Noto Sans";
  const pages: BookDesign["pages"] = [
    {
      pageId: "cover",
      type: "cover",
      layout: "cover",
      title: content.title,
      illustrationAssetId: "cover"
    },
    ...content.creatures.flatMap((creature) => [
      {
        pageId: `${creature.creatureId}-poem`,
        type: "poem" as const,
        layout: "illustration-top" as const,
        creatureId: creature.creatureId,
        creature: creature.displayName,
        title: creature.displayName,
        poemTitle: creature.poem.title,
        body: normalizePoemText(creature.poem.text),
        illustrationAssetId: `creature-${creature.creatureId}`
      },
      {
        pageId: `${creature.creatureId}-fun-fact`,
        type: "funFact" as const,
        layout: "illustration-top" as const,
        creatureId: creature.creatureId,
        creature: creature.displayName,
        title: `${creature.displayName} — Fun Fact`,
        body: creature.funFact.text,
        illustrationAssetId: `creature-${creature.creatureId}`
      },
      {
        pageId: `${creature.creatureId}-activity`,
        type: "activity" as const,
        layout: "illustration-top" as const,
        creatureId: creature.creatureId,
        creature: creature.displayName,
        title: `${creature.displayName} — Activity`,
        body: creature.activity.text,
        illustrationAssetId: `creature-${creature.creatureId}`
      }
    ]),
    ...(content.closingNote?.trim() ? [{
      pageId: "closing",
      type: "closing" as const,
      layout: "closing" as const,
      title: "Keep Exploring",
      body: content.closingNote
    }] : [])
  ];
  return bookDesignSchema.parse({
    designVersion: "1.0",
    language: content.language,
    designRevision,
    sourceRevision,
    illustrationSetDigest: illustrationSetDigest(assets),
    status: "ready_for_review",
    createdAt,
    theme: {
      name: "Friendly Natural",
      colors: {
        primary: "#17324D",
        secondary: "#147D92",
        accent: "#E76F51",
        background: "#FFF9ED",
        surface: "#FFFFFF",
        text: "#263238"
      },
      headingFont,
      bodyFont: headingFont,
      cornerRadius: 24
    },
    formatProfiles: {
      document: { size: "A4", orientation: "portrait" },
      presentation: { size: "LAYOUT_WIDE", orientation: "landscape" }
    },
    pages,
    formatExceptions: [{
      format: "pptx",
      message: "The presentation uses the canonical wide profile while preserving the approved page plan, content, colors, typography intent, and illustration assets."
    }, {
      format: "canva",
      message: "Canva uses the canonical wide profile and may substitute unavailable fonts only when the substitution is reported for review."
    }]
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]!);
}

export interface HtmlAssetReference {
  href: string;
  altText: string;
}

export function renderBookDesignHtml(designInput: BookDesign, assetHrefs: Record<string, HtmlAssetReference>): string {
  const design = bookDesignSchema.parse(designInput);
  const theme = design.theme;
  const pageMarkup = design.pages.map((page) => {
    const image = page.illustrationAssetId
      ? `<img class="illustration" src="${escapeHtml(assetHrefs[page.illustrationAssetId]?.href ?? "")}" alt="${escapeHtml(assetHrefs[page.illustrationAssetId]?.altText ?? "")}" />`
      : "";
    if (page.type === "cover") {
      return `<section class="page cover" data-page-id="${escapeHtml(page.pageId)}">${image}<h1>${escapeHtml(page.title)}</h1></section>`;
    }
    if (page.type === "closing") {
      return `<section class="page closing" data-page-id="${escapeHtml(page.pageId)}"><h1>${escapeHtml(page.title)}</h1><div class="body">${escapeHtml(page.body)}</div></section>`;
    }
    const sectionLabel = page.type === "funFact" ? "Fun Fact" : page.type === "activity" ? "Activity" : page.poemTitle;
    return `<section class="page section-page" data-page-id="${escapeHtml(page.pageId)}">${image}<h1>${escapeHtml(page.title)}</h1><h2>${escapeHtml(sectionLabel ?? "")}</h2><div class="body ${page.type === "poem" ? "poem" : ""}">${escapeHtml(page.body)}</div></section>`;
  }).join("\n");
  return `<!doctype html>
<html lang="${design.language}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(design.pages[0]?.type === "cover" ? design.pages[0].title : "Book design preview")}</title>
<style>
@font-face{font-family:"Noto Sans";src:url("../assets/fonts/NotoSans-Regular.ttf") format("truetype");font-weight:400;font-style:normal;font-display:swap}@font-face{font-family:"Noto Sans";src:url("../assets/fonts/NotoSans-Bold.ttf") format("truetype");font-weight:700;font-style:normal;font-display:swap}
@font-face{font-family:"Noto Sans Kannada";src:url("../assets/fonts/NotoSansKannada.ttf") format("truetype");font-weight:400 700;font-style:normal;font-display:swap}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:${theme.colors.background};color:${theme.colors.text};font-family:${JSON.stringify(theme.bodyFont)},"Noto Sans",sans-serif}.page{width:210mm;min-height:297mm;margin:12mm auto;padding:18mm;background:${theme.colors.surface};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8mm;page-break-after:always;border:2px solid ${theme.colors.secondary};border-radius:${theme.cornerRadius}px;overflow:hidden}.cover{background:${theme.colors.primary};color:#FFFFFF}.illustration{display:block;width:100%;max-height:145mm;object-fit:contain;border-radius:${theme.cornerRadius}px}.cover .illustration{max-height:190mm}.cover h1{font-size:32pt;text-align:center;margin:0}.section-page h1,.closing h1{font-size:25pt;color:${theme.colors.primary};text-align:center;margin:0}.section-page h2{font-size:19pt;color:${theme.colors.secondary};margin:0}.body{font-size:16pt;line-height:1.45;text-align:center;max-width:165mm;white-space:pre-wrap}.poem{font-size:19pt;line-height:1.55}.closing{background:${theme.colors.accent}}@media print{.page{margin:0;border:0;border-radius:0}}
</style>
</head>
<body data-design-revision="${design.designRevision}" data-source-revision="${design.sourceRevision}" data-illustration-set-digest="${design.illustrationSetDigest}">
${pageMarkup}
</body>
</html>\n`;
}
