#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { closingNoteCorrectionSchema, creatureSchema, interactiveBookRequestSchema, illustrationRoleSchema } from "./domain.ts";
import {
  acceptBookContent,
  acceptPrimaryOutput,
  acceptCanvaResult,
  approveBookDesign,
  approveCreatureSelection,
  consentToCanva,
  createPromptPackage,
  createIllustrationPromptPackage,
  createBookDesignPreview,
  deliverySummary,
  generateDocuments,
  getCanvaHandoff,
  initializeProject,
  importProjectIllustration,
  importProjectCodeNativeIllustrationSet,
  reworkPrimaryOutput,
  replaceClosingNote,
  replaceCreatureContent,
  reviewProjectIllustration,
  selectCanvaDesign,
  reiterateAuthoringPrompt,
  setCanvaCapability,
  updateCreatureSelection
} from "./workflow.ts";
import { loadProject } from "./project.ts";

const server = new McpServer({
  name: "ai-bookagent-mcp-lite",
  version: "0.1.0"
});

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
});

server.registerTool(
  "create_book_project",
  {
    description: "Create a portable creature poetry-book project after explicitly asking the user for age band and language. Kannada is experimental and requires fluent human review and discretion. DOCX is always mandatory.",
    inputSchema: {
      projectDir: z.string().min(1).describe("An absolute, host-selected project directory."),
      request: interactiveBookRequestSchema
    }
  },
  async ({ projectDir, request }) => text(await initializeProject(projectDir, request))
);

server.registerTool(
  "reiterate_authoring_prompt",
  {
    description: "Prepare the next poem iteration automatically: first at the selected age, then at the next age band (12-14 remains 12-14).",
    inputSchema: { projectDir: z.string().min(1) }
  },
  async ({ projectDir }) => text(await reiterateAuthoringPrompt(projectDir))
);

server.registerTool(
  "set_creature_selection",
  {
    description: "Set or regenerate the creature list. Only two usable full-list regenerations are permitted.",
    inputSchema: {
      projectDir: z.string().min(1),
      creatures: z.array(creatureSchema).min(1).max(20),
      excludePrevious: z.boolean().default(false)
    }
  },
  async ({ projectDir, creatures, excludePrevious }) =>
    text(await updateCreatureSelection(projectDir, creatures, excludePrevious))
);

server.registerTool(
  "approve_creature_selection",
  {
    description: "Lock the reviewed creature list before content generation.",
    inputSchema: { projectDir: z.string().min(1) }
  },
  async ({ projectDir }) => text(await approveCreatureSelection(projectDir))
);

server.registerTool(
  "prepare_authoring_prompt",
  {
    description: "Prepare FullPipelineV3-inspired prompt batches for host-assisted Claude generation.",
    inputSchema: { projectDir: z.string().min(1) }
  },
  async ({ projectDir }) => text(await createPromptPackage(projectDir))
);

server.registerTool(
  "prepare_illustration_prompts",
  {
    description: "Prepare a host-assisted prompt package for one cover and one consistent illustration per creature. This connector does not require a paid image API.",
    inputSchema: { projectDir: z.string().min(1) }
  },
  async ({ projectDir }) => text(await createIllustrationPromptPackage(projectDir))
);

server.registerTool(
  "import_illustration_asset",
  {
    description: "Copy a host-generated or user-supplied PNG/JPEG into the project with dimensions, digest, accessibility, provenance, and license metadata. Imported artwork remains pending review.",
    inputSchema: {
      projectDir: z.string().min(1),
      role: illustrationRoleSchema,
      creatureId: z.string().min(1).optional(),
      sourcePath: z.string().min(1),
      altText: z.string().min(1),
      source: z.enum(["host_generated", "user_supplied"]),
      provenance: z.object({
        createdBy: z.string().min(1).optional(),
        generator: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        sourceUri: z.string().url().optional(),
        promptDigest: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
        notes: z.string().min(1).optional()
      }).default({}),
      license: z.object({
        name: z.string().min(1),
        url: z.string().url().optional(),
        attribution: z.string().min(1).optional(),
        usageNotes: z.string().min(1).optional()
      })
    }
  },
  async ({ projectDir, ...input }) => text(await importProjectIllustration(projectDir, input))
);

server.registerTool(
  "import_code_native_illustration_set",
  {
    description: "Import the complete cover-and-creature illustration set as Claude-authored constrained SVG. The tool strictly rejects executable, linked, embedded, or text content, rasterizes approved markup locally to PNG, and records provenance without requiring external image files.",
    inputSchema: {
      projectDir: z.string().min(1),
      assets: z.array(z.object({
        role: illustrationRoleSchema,
        creatureId: z.string().min(1).optional(),
        svg: z.string().min(1),
        altText: z.string().min(1),
        createdBy: z.string().min(1).default("Claude"),
        model: z.string().min(1).optional(),
        promptDigest: z.string().regex(/^[a-f0-9]{64}$/u).optional()
      })).min(2).max(21)
    }
  },
  async ({ projectDir, assets }) => text(await importProjectCodeNativeIllustrationSet(projectDir, assets))
);

server.registerTool(
  "create_book_design_preview",
  {
    description: "Create the canonical BookDesign manifest and a self-contained local HTML-first preview from validated content and the complete illustration set. The preview is the review source for every downstream format.",
    inputSchema: { projectDir: z.string().min(1) }
  },
  async ({ projectDir }) => text(await createBookDesignPreview(projectDir))
);

server.registerTool(
  "approve_book_design",
  {
    description: "Approve the current canonical HTML book design and all illustrations shown in it in one batch review. This unlocks faithful DOCX, PPTX, PDF, and Canva outputs.",
    inputSchema: {
      projectDir: z.string().min(1),
      reviewedBy: z.string().min(1),
      note: z.string().min(1).optional()
    }
  },
  async ({ projectDir, reviewedBy, note }) => text(await approveBookDesign(projectDir, reviewedBy, note))
);

server.registerTool(
  "review_illustration_asset",
  {
    description: "Approve or reject one imported illustration. Every required slot must be approved before final export.",
    inputSchema: {
      projectDir: z.string().min(1),
      assetId: z.string().min(1),
      approved: z.boolean(),
      reviewedBy: z.string().min(1),
      note: z.string().min(1).optional()
    }
  },
  async ({ projectDir, assetId, approved, reviewedBy, note }) => text(await reviewProjectIllustration(projectDir, assetId, approved, reviewedBy, note))
);

server.registerTool(
  "validate_book_content",
  {
    description: "Validate and save Claude-generated structured poetry, facts, and activities.",
    inputSchema: {
      projectDir: z.string().min(1),
      content: z.unknown()
    }
  },
  async ({ projectDir, content }) => text(await acceptBookContent(projectDir, content))
);

server.registerTool(
  "create_document_exports",
  {
    description: "Create faithful outputs from the approved canonical BookDesign: primary DOCX by default, then accepted-current-design PPTX/PDF secondary outputs.",
    inputSchema: {
      projectDir: z.string().min(1),
      formats: z.array(z.enum(["docx", "pptx", "pdf"])).optional()
    }
  },
  async ({ projectDir, formats }) => text(await generateDocuments(projectDir, formats))
);

server.registerTool(
  "accept_primary_output",
  {
    description: "Accept the reviewed DOCX for the current source revision and unlock secondary outputs.",
    inputSchema: { projectDir: z.string().min(1), note: z.string().optional() }
  },
  async ({ projectDir, note }) => text(await acceptPrimaryOutput(projectDir, note))
);

server.registerTool(
  "rework_primary_output",
  {
    description: "Replace validated book content and regenerate DOCX. At most two primary-output reworks are allowed.",
    inputSchema: { projectDir: z.string().min(1), content: z.unknown() }
  },
  async ({ projectDir, content }) => text(await reworkPrimaryOutput(projectDir, content))
);

server.registerTool(
  "replace_closing_note",
  {
    description: "Replace only the validated book-level closing note without consuming authoring iterations or primary-output reworks. Existing designs and outputs become stale and require fresh review.",
    inputSchema: {
      projectDir: z.string().min(1),
      closingNote: closingNoteCorrectionSchema
    }
  },
  async ({ projectDir, closingNote }) => text(await replaceClosingNote(projectDir, closingNote))
);

server.registerTool(
  "replace_creature_content",
  {
    description: "Replace and revalidate one creature while preserving all other generated content. An alternative rhyme scheme requires an explicit human-approved attestation and is available only for this incremental correction.",
    inputSchema: {
      projectDir: z.string().min(1),
      creature: z.unknown(),
      humanApprovedRhymeScheme: z.enum(["ABA", "ABAB", "AABB"]).optional().describe("Explicit human-approved alternative for this creature correction; it must equal creature.poem.rhymeScheme.")
    }
  },
  async ({ projectDir, creature, humanApprovedRhymeScheme }) => text(await replaceCreatureContent(projectDir, creature, humanApprovedRhymeScheme))
);

server.registerTool(
  "check_canva_readiness",
  {
    description: "Record host-reported Canva setup and authorization readiness without sending book content.",
    inputSchema: {
      projectDir: z.string().min(1),
      status: z.enum(["ready", "unavailable", "authorization_required"]),
      connectorName: z.string().optional(),
      toolName: z.string().optional()
    }
  },
  async ({ projectDir, ...capability }) => text(await setCanvaCapability(projectDir, capability))
);

server.registerTool(
  "confirm_canva_handoff",
  {
    description: "Persist explicit approval or decline before any content is handed to Canva.",
    inputSchema: {
      projectDir: z.string().min(1),
      consent: z.boolean()
    }
  },
  async ({ projectDir, consent }) => text(await consentToCanva(projectDir, consent))
);

server.registerTool(
  "select_canva_design",
  {
    description: "Record the user's Canva design selection before requesting mutation-specific consent.",
    inputSchema: {
      projectDir: z.string().min(1),
      designId: z.string().min(1),
      title: z.string().min(1),
      templateUrl: z.string().url().optional()
    }
  },
  async ({ projectDir, designId, title, templateUrl }) =>
    text(await selectCanvaDesign(projectDir, { designId, title, templateUrl }))
);

server.registerTool(
  "prepare_canva_handoff",
  {
    description: "Return an adapter-neutral Canva payload after local delivery and consent; this tool never invokes Canva.",
    inputSchema: { projectDir: z.string().min(1) }
  },
  async ({ projectDir }) => text(await getCanvaHandoff(projectDir))
);

server.registerTool(
  "record_canva_result",
  {
    description: "Persist either a structured connector failure or a validated Canva design result.",
    inputSchema: {
      projectDir: z.string().min(1),
      outcome: z.enum(["success", "failed"]),
      designId: z.string().min(1).optional(),
      editUrl: z.string().url().optional(),
      sourceRevision: z.number().int().positive().optional(),
      designRevision: z.number().int().positive().optional(),
      illustrationSetDigest: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
      pageCount: z.number().int().positive().optional(),
      code: z.string().min(1).optional(),
      message: z.string().min(1).optional(),
      retryable: z.boolean().optional()
    }
  },
  async ({ projectDir, ...result }) => text(await acceptCanvaResult(projectDir, result))
);

server.registerTool(
  "get_delivery_summary",
  {
    description: "Report creatures covered, local exports, review status, and Canva status.",
    inputSchema: { projectDir: z.string().min(1) }
  },
  async ({ projectDir }) => text(deliverySummary(await loadProject(projectDir)))
);

const transport = new StdioServerTransport();
await server.connect(transport);
