# AI Book Agent MCP Lite

A lightweight, host-assisted Model Context Protocol server for creating children's creature poetry books. Development requires no paid model API token: the MCP prepares structured prompts for Claude, validates the returned content, creates local documents, and optionally prepares a consent-gated Canva handoff.

## MVP

Each approved creature receives:

1. A titled, age-structured poem
2. A factual fun section
3. A safe activity

The primary artifact is always DOCX. After reviewing it, the user may rework it (at most twice), accept it and finish, create optional PPTX/PDF secondary outputs, or continue to Canva. Canva is the final optional output.

The DOCX page sequence is deterministic: one cover, then one poem page, one fun-fact page, and one activity page for every approved creature. A non-empty closing note adds one final page. The projected page count is therefore `1 + (3 × creatures) + optional closing page`.

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
- Age is the only poem-structure choice; stanza, line, rhyme, and word defaults are automatic
- Two poem iterations: the first stays in the selected age band and the second advances one band (12–14 remains 12–14)
- Canva: optional, resumable, and explicitly consent-gated

## Workflow

```text
brief
  -> choose age once
  -> creature list
  -> approve / manually edit / regenerate (at most twice)
  -> host-assisted Claude prompt batches
  -> optional poem iteration 1 (same age)
  -> optional poem iteration 2 (next age; 12-14 remains unchanged)
  -> validate structured content
  -> primary DOCX
  -> review: rework (maximum two) or accept
  -> optional PPTX and/or PDF
  -> optional Canva readiness check
  -> select Canva design
  -> user consent
  -> connector handoff
  -> record genuine Canva edit URL
```

The MCP does not install Canva, perform OAuth, or call paid model APIs. Claude/Canva setup remains under the user's control.

## Poem defaults

| Age | Stanzas | Lines per stanza | Rhyme |
| --- | ---: | ---: | --- |
| 3–5 | 2 | 2 | AA |
| 6–8 | 2 | 3 | AAB |
| 9–11 | 3 | 4 | AABB |
| 12–14 | 4 | 3 | AAB |

Every poem has a short title. Line and stanza breaks are preserved in every export. Immediate full-stanza repetition is rejected. English rhyme follows the declared scheme; experimental Kannada is authored as a native adaptation and requires human review. See [MVP poem structure](docs/poem-structure.md).

DOCX typography follows the effective authoring age. Poem/body sizes are 22/20 pt for ages 3–5, 20/18 pt for 6–8, 18/16 pt for 9–11, and 16/14 pt for 12–14. The exporter never silently truncates or shrinks content below these sizes; validation blocks content that exceeds its age-specific page budget.

These rules are the upstream content contract for DOCX, PPTX, PDF, and Canva work. Exporter-specific tasks may change layout and rendering, but should not redefine poem structure or the age-iteration sequence.

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

DOCX generation itself remains local and requires no Office installation, cloud conversion, Canva access, or paid API. Optional visual QA uses local LibreOffice and Poppler. Kannada DOCX release QA requires `Noto Sans Kannada` to be installed and remains subject to human language and rendered-glyph review under issue #1.

PPTX does not embed `Noto Sans Kannada`; Kannada decks therefore include an export warning and require the font on every viewing or editing system.

PDF uses a fixed cover-plus-three-pages-per-creature A4 layout and embeds the bundled free Noto Sans fonts for English. Optional closing notes are not included in the MVP PDF. Overflow or optional PDF failures are reported without invalidating a successful mandatory DOCX. See [MVP PDF generation](docs/pdf-generation.md).

## CLI

```bash
ai-bookagent init ./my-book ./request.json
ai-bookagent select ./my-book ./creatures.json
ai-bookagent approve ./my-book
ai-bookagent prompt ./my-book
# A host may call the reiterate_authoring_prompt MCP tool up to twice.
ai-bookagent content ./my-book ./claude-content.json
ai-bookagent export ./my-book docx,pptx,pdf
ai-bookagent accept-docx ./my-book
ai-bookagent rework ./my-book ./reworked-content.json
ai-bookagent summary ./my-book
```

Generated files and resumable state stay inside the selected book-project directory. File targets are constrained to that directory.

## Canva checkpoint

The current DOCX must be explicitly accepted before any secondary output. A rework creates a new source revision, makes prior outputs stale, regenerates DOCX, and clears acceptance. After acceptance, PPTX and PDF may be created independently. Canva then:

1. Record whether the host exposes an authorized Canva connector.
2. Return installation/authorization guidance when unavailable.
3. Record the user's chosen Canva design.
4. Pause for consent scoped to that design and source revision.
5. Produce a connector-ready handoff.
6. Validate the returned Canva URL against the `canva.com` domain.

The project never invents an edit link.

## Security and publishing

- User source material is delimited as data-only in prompts.
- Local paths are runtime configuration, not source constants.
- `npm run check:paths` rejects common user-specific absolute paths.
- Credentials, output packages, raw logs, and local environment files are ignored.
- Fun facts are marked for review unless a human or approved source supports them.

See [Architecture](docs/architecture.md), [Tool contracts](docs/tool-contracts.md), and [Canva handoff](docs/canva-handoff.md).
