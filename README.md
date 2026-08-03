# AI Book Agent MCP Lite

A lightweight, host-assisted Model Context Protocol server for creating children's creature poetry books. Development requires no paid model API token: the MCP prepares structured prompts for Claude, validates the returned content, creates local documents, and optionally prepares a consent-gated Canva handoff.

## MVP

Each approved creature receives:

1. A poem
2. A factual fun section
3. A safe activity

The mandatory artifact is DOCX. PPTX and PDF are optional and are generated before the optional Canva phase.

PPTX output uses editable native text and shapes with a deterministic cover plus poem, fun-fact, and activity slide for every creature (`1 + 3 × creatures`). Age-band typography, blocking overflow limits, structural checks, accessibility behavior, and visual QA are specified in [MVP PowerPoint generation](docs/pptx-generation.md).

### Boundaries

- Default: 5 creatures
- Maximum: 20 creatures
- Maximum projected length: 100 pages/slides
- More than 10 creatures: generated in batches of 5
- Creature-list regenerations: 2 after the initial list
- English: standard
- Kannada: experimental and requires human review
- Audience: ages 3-14
- Canva: optional, resumable, and explicitly consent-gated

## Workflow

```text
brief
  -> creature list
  -> approve / manually edit / regenerate (at most twice)
  -> host-assisted Claude prompt batches
  -> validate structured content
  -> DOCX
  -> optional PPTX/PDF
  -> Canva readiness check
  -> user consent
  -> connector handoff
  -> record genuine Canva edit URL
```

The MCP does not install Canva, perform OAuth, or call paid model APIs. Claude/Canva setup remains under the user's control.

## Requirements

- Node.js 20 or newer
- pnpm or npm
- Optional for visual QA: LibreOffice and Poppler

## Install

```bash
pnpm install
pnpm build
pnpm test
```

This repository is portable. Clone it anywhere, including another drive, without editing source paths.

## Run as an MCP server

Build the project and configure the host with an absolute path at installation time:

```json
{
  "mcpServers": {
    "ai-bookagent": {
      "command": "node",
      "args": ["/path/to/ai-bookagent-mcp-lite/dist/server.js"]
    }
  }
}
```

The example intentionally uses a placeholder. Do not commit a machine-specific MCP configuration.

Kannada DOCX/PPTX uses the `Noto Sans Kannada` font family. Kannada PDF export
also requires `BOOK_AGENT_KANNADA_FONT_PATH` in the user's uncommitted `.env`
file so the font can be embedded. The exporter fails clearly instead of
producing a PDF with missing glyphs.

PPTX does not embed `Noto Sans Kannada`; Kannada decks therefore include an export warning and require the font on every viewing or editing system.

## CLI

```bash
ai-bookagent init ./my-book ./request.json
ai-bookagent select ./my-book ./creatures.json
ai-bookagent approve ./my-book
ai-bookagent prompt ./my-book
ai-bookagent content ./my-book ./claude-content.json
ai-bookagent export ./my-book docx,pptx,pdf
ai-bookagent summary ./my-book
```

Generated files and resumable state stay inside the selected book-project directory. File targets are constrained to that directory.

## Canva checkpoint

Local documents are delivered first. The Canva tools then:

1. Record whether the host exposes an authorized Canva connector.
2. Return installation/authorization guidance when unavailable.
3. Pause for explicit consent.
4. Produce a connector-ready handoff.
5. Validate the returned Canva URL against the `canva.com` domain.

The project never invents an edit link.

## Security and publishing

- User source material is delimited as data-only in prompts.
- Local paths are runtime configuration, not source constants.
- `npm run check:paths` rejects common user-specific absolute paths.
- Credentials, output packages, raw logs, and local environment files are ignored.
- Fun facts are marked for review unless a human or approved source supports them.

See [Architecture](docs/architecture.md), [Tool contracts](docs/tool-contracts.md), and [Canva handoff](docs/canva-handoff.md).
