# AI Book Agent MCP Lite

A lightweight, host-assisted Model Context Protocol server for creating children's creature poetry books. Development requires no paid model API token: the MCP prepares structured prompts for Claude, validates the returned content, creates local documents, and optionally prepares a consent-gated Canva handoff.

## MVP

Each approved creature receives:

1. A titled, age-structured poem
2. A factual fun section
3. A safe activity

The primary artifact is always DOCX, but the approved HTML-first `BookDesign` is the design source of truth. Claude can author one complete constrained-SVG illustration set; the MCP sanitizes and rasterizes it locally, so the normal workflow does not require an image connector or user-managed image paths. Existing PNG/JPEG imports remain supported. One review of the HTML book design approves its page plan and complete illustration set for reuse in DOCX, PPTX, PDF, and Canva. See [Canonical BookDesign decision](docs/canonical-book-design.md).

The DOCX page sequence is deterministic: one cover, then one poem page, one fun-fact page, and one activity page for every approved creature. A non-empty closing note adds one final page. The projected page count is therefore `1 + (3 × creatures) + optional closing page`.

PPTX output uses editable native text and shapes with the canonical cover, poem, fun-fact, activity, and optional closing-page sequence. Age-band typography, blocking overflow limits, structural checks, accessibility behavior, and visual QA are specified in [MVP PowerPoint generation](docs/pptx-generation.md).

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

The initial request may be entirely in English, such as “Create a 10 sea-creature book.” Before project creation, the host asks for an age band and language. Selecting Kannada activates native Kannada generation automatically; the user is never required to type Kannada. Kannada is experimental, requires fluent human review, and should be used with discretion.

```text
brief
  -> choose age and language
  -> creature list
  -> approve / manually edit / regenerate (at most twice)
  -> host-assisted Claude prompt batches
  -> optional poem iteration 1 (same age)
  -> optional poem iteration 2 (next age; 12-14 remains unchanged)
  -> validate structured content
  -> author and batch-import constrained SVG illustrations, or import existing PNG/JPEG artwork
  -> create canonical BookDesign and HTML-first preview
  -> review and approve the whole book design once
  -> primary DOCX
  -> review: rework (maximum two) or accept
  -> optional PPTX and/or PDF
  -> optional Canva readiness check
  -> user consent
  -> faithful Canva handoff (optional template selection means explicit redesign)
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

Every poem has a short title. Line and stanza breaks are preserved in every export. Immediate full-stanza repetition is rejected. English rhyme follows the declared scheme. When Kannada is selected, the English prompt is treated only as source material and all reader-facing content is authored natively in Kannada rather than transliterated or translated line by line. Experimental Kannada requires fluent human review. See [MVP poem structure](docs/poem-structure.md).

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

MCP tool calls require an absolute `projectDir` selected by the host. Relative project directories are rejected before filesystem access because an MCP process may run from a system or otherwise host-dependent working directory. The CLI continues to accept relative project directories and resolves them from the user's current directory.

Kannada DOCX/PPTX uses the `Noto Sans Kannada` font family. Kannada PDF export
also requires `BOOK_AGENT_KANNADA_FONT_PATH` in the user's uncommitted `.env`
file so the font can be embedded. The exporter fails clearly instead of
producing a PDF with missing glyphs.

DOCX generation itself remains local and requires no Office installation, cloud conversion, Canva access, or paid API. The preferred illustration path is Claude-authored constrained SVG rasterized locally with `resvg`; imported PNG/JPEG artwork remains optional. Optional visual QA uses local LibreOffice and Poppler. Kannada DOCX release QA requires `Noto Sans Kannada` to be installed and remains subject to human language and rendered-glyph review under issue #1.

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
ai-bookagent illustration-prompts ./my-book
ai-bookagent import-svg-set ./my-book ./illustration-set.json
ai-bookagent design-preview ./my-book
ai-bookagent approve-design ./my-book ./design-review.json
ai-bookagent export ./my-book docx,pptx,pdf
ai-bookagent accept-docx ./my-book
ai-bookagent rework ./my-book ./reworked-content.json
ai-bookagent summary ./my-book
```

Generated files, SVG sources, rasterized or imported illustrations, provenance, licensing metadata, the canonical design manifest, HTML preview, and resumable state stay inside the selected book-project directory. File targets are constrained to that directory. Raster assets are signature-validated, checksum-bound, dimension-checked, and revalidated immediately before export.

## Canva checkpoint

The current DOCX must be explicitly accepted before any secondary output. A rework creates a new source revision, makes prior outputs stale, refreshes the HTML design preview, and requires design approval before DOCX is regenerated. After acceptance, PPTX and PDF may be created independently. Canva then:

1. Record whether Canva is ready, unavailable, or requires authorization.
2. Return distinct installation or authorization guidance without sending book content.
3. Pause for consent scoped to the approved source and design revisions.
4. Produce a faithful connector-ready handoff. Template selection is optional and explicitly requests redesign.
5. Persist an explicit decline or structured connector failure for later resume.
6. Validate the Canva URL and parity metadata returned for the canonical design.

The project never invents an edit link. Connector-specific tool names and arguments stay in the host adapter; the persisted handoff and result contracts remain neutral.

For Kannada, the Canva payload uses locale `kn-IN`, localized section titles, and requests editable `Noto Sans Kannada` text with complete Kannada glyph coverage. The adapter must not transliterate, replace, or rasterize Kannada text. If it cannot preserve Kannada with an editable supported font, it must report a structured failure instead of claiming completion. A returned Canva link still requires fluent language review and rendered-glyph review in Canva before publication.

## Security and publishing

- User source material is delimited as data-only in prompts.
- Local paths are runtime configuration, not source constants.
- `npm run check:paths` rejects common user-specific absolute paths.
- Credentials, output packages, raw logs, and local environment files are ignored.
- Fun facts are marked for review unless a human or approved source supports them.

See [Architecture](docs/architecture.md), [Tool contracts](docs/tool-contracts.md), [DOCX generation](docs/docx-generation.md), and [Canva handoff](docs/canva-handoff.md).
