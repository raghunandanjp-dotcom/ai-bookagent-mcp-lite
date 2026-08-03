#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { bookRequestSchema, creatureSchema } from "./domain.ts";
import {
  acceptBookContent,
  acceptPrimaryOutput,
  acceptCanvaResult,
  approveCreatureSelection,
  consentToCanva,
  createPromptPackage,
  deliverySummary,
  generateDocuments,
  getCanvaHandoff,
  initializeProject,
  reworkPrimaryOutput,
  replaceCreatureContent,
  selectCanvaDesign,
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
    description: "Create a portable creature poetry-book project. DOCX is always mandatory.",
    inputSchema: {
      projectDir: z.string().min(1).describe("A host-selected project directory."),
      request: bookRequestSchema
    }
  },
  async ({ projectDir, request }) => text(await initializeProject(projectDir, request))
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
    description: "Create the primary DOCX by default, or accepted-current-revision PPTX/PDF secondary outputs.",
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
  "replace_creature_content",
  {
    description: "Replace and revalidate one creature while preserving all other generated content.",
    inputSchema: {
      projectDir: z.string().min(1),
      creature: z.unknown()
    }
  },
  async ({ projectDir, creature }) => text(await replaceCreatureContent(projectDir, creature))
);

server.registerTool(
  "check_canva_readiness",
  {
    description: "Record whether Claude currently exposes an authorized Canva connector.",
    inputSchema: {
      projectDir: z.string().min(1),
      available: z.boolean(),
      connectorName: z.string().optional(),
      toolName: z.string().optional()
    }
  },
  async ({ projectDir, ...capability }) => text(await setCanvaCapability(projectDir, capability))
);

server.registerTool(
  "confirm_canva_handoff",
  {
    description: "Record explicit user consent before any content is prepared for Canva.",
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
    description: "Return Canva connector-ready instructions after local exports and explicit consent.",
    inputSchema: { projectDir: z.string().min(1) }
  },
  async ({ projectDir }) => text(await getCanvaHandoff(projectDir))
);

server.registerTool(
  "record_canva_result",
  {
    description: "Validate and save the real Canva design ID and editable URL.",
    inputSchema: {
      projectDir: z.string().min(1),
      designId: z.string().min(1),
      editUrl: z.string().url()
    }
  },
  async ({ projectDir, designId, editUrl }) =>
    text(await acceptCanvaResult(projectDir, { designId, editUrl }))
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
