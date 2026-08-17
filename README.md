# AI Book Agent MCP Lite

AI Book Agent MCP Lite is a local, host-assisted Model Context Protocol (MCP) server that turns an approved creature list into a reviewable children's poetry book. It asks Claude to author structured content and constrained SVG illustrations, validates the result, and creates editable DOCX, PPTX, and PDF files without a paid model API key.

The design source of truth is a self-contained HTML preview. One explicit review binds its page plan and complete illustration set to every export. Canva is optional and always requires separate consent.

## What is supported

Stable for the release candidate:

- English books for ages 3–14, with 1–20 creatures (5 by default)
- Deterministic cover, poem, fun-fact, activity, and optional closing pages
- Claude-authored constrained SVG illustrations, sanitized and rasterized locally
- Existing PNG/JPEG artwork with provenance, license, dimensions, and checksum records
- An HTML-first design review followed by local DOCX, PPTX, and PDF generation
- Resumable project state, two creature-list regenerations, and two DOCX reworks
- Optional, consent-gated, adapter-neutral Canva handoff

Experimental or externally gated:

- Kannada authoring requires a fluent human language review and rendered-glyph review. Kannada PDF also requires a locally configured Kannada TTF font.
- Canva completion requires a compatible authorized host adapter; this server does not perform OAuth or call Canva itself.
- DOCX/PPTX reference rendering for release QA requires LibreOffice and Poppler. They are not required to create the files.

Not supported: unattended factual publication, arbitrary SVG/HTML, cloud storage, built-in OAuth, or a hosted MCP endpoint. Fun facts remain review items unless a human or approved source supports them.

## Requirements

- Node.js 20 or newer
- npm (the committed lockfile is the reproducible install source)
- Claude Desktop or another stdio-capable MCP host
- Optional for visual QA: LibreOffice and Poppler

The DOCX visual-QA harness discovers LibreOffice on `PATH` and in standard Windows install locations. Set `AI_BOOKAGENT_SOFFICE` or `AI_BOOKAGENT_PDFTOPPM` to an explicit executable when using a portable/nonstandard install. Render commands use an isolated LibreOffice profile and a 120-second per-command timeout; set `AI_BOOKAGENT_RENDER_TIMEOUT_MS` to an integer from 1000 through 600000 when a slower machine needs a different bound.

## Install

### From this repository (available now)

```bash
git clone https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite.git
cd ai-bookagent-mcp-lite
npm ci
npm run build
npm run check
```

The package name is reserved in `package.json`, but this README does **not** assert that an npm registry release exists. Verify the package on npm before using a registry command. After an npm release is explicitly published, the intended global install is:

```bash
npm install --global ai-bookagent-mcp-lite
```

For local CLI development, use `node dist/cli.js ...` after building or run `npm link` if you want the `ai-bookagent` and `ai-bookagent-mcp` commands on your PATH.

## Connect Claude Desktop

Use Claude Desktop's **Settings → Developer → Edit Config**, then add the server to the existing `mcpServers` object. The config file is normally `%APPDATA%\Claude\claude_desktop_config.json` on Windows or `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS. The [official MCP local-server guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers) has the current host instructions and log locations.

For a local build, use absolute paths and replace the placeholders:

```json
{
  "mcpServers": {
    "ai-bookagent": {
      "command": "node",
      "args": ["/absolute/path/to/ai-bookagent-mcp-lite/dist/server.js"]
    }
  }
}
```

On Windows, JSON paths may use forward slashes (`C:/absolute/path/dist/server.js`) or escaped backslashes (`C:\\absolute\\path\\dist\\server.js`). Completely quit and restart Claude Desktop after saving. A future global npm installation can launch `ai-bookagent-mcp`; on Windows, use `"command": "cmd"` with `"args": ["/c", "ai-bookagent-mcp"]` if Claude cannot resolve the npm `.cmd` shim.

Never commit a machine-specific Claude Desktop config. MCP calls also require an absolute, host-selected `projectDir`; relative MCP project directories are rejected before filesystem access.

## First book

In a new Claude Desktop chat, try:

> Create a five-creature ocean poetry book. Save the project in an absolute folder I choose, use English for ages 6–8, and pause at every review gate.

The normal flow is:

```text
choose age and language
  → review and approve the creature list
  → Claude authors structured content
  → review facts, safety, and reader-facing text
  → Claude authors one constrained-SVG illustration set
  → review the complete HTML book design once
  → generate and review the DOCX
  → accept or rework the DOCX
  → optionally generate PPTX/PDF
  → optionally authorize and consent to Canva handoff
```

Generated content, SVG sources, raster assets, design files, exports, checksums, and resumable state remain inside the selected project directory. Review the HTML and DOCX visually; the server's validation is not a substitute for editorial, factual, language, or accessibility judgment.

## CLI quick reference

The CLI is useful for fixture-driven or scripted local work. JSON inputs use the schemas documented in [Tool contracts](docs/tool-contracts.md).

```bash
ai-bookagent init ./my-book ./request.json
ai-bookagent select ./my-book ./creatures.json
ai-bookagent approve ./my-book
ai-bookagent prompt ./my-book
ai-bookagent content ./my-book ./claude-content.json
ai-bookagent illustration-prompts ./my-book
ai-bookagent import-svg-set ./my-book ./illustration-set.json
ai-bookagent design-preview ./my-book
ai-bookagent approve-design ./my-book ./design-review.json
ai-bookagent export ./my-book docx
ai-bookagent accept-docx ./my-book
ai-bookagent export ./my-book pptx,pdf
ai-bookagent summary ./my-book
```

The CLI accepts relative project directories and resolves them from the current shell. The MCP server deliberately requires absolute project directories because a desktop host may start it with an unpredictable working directory.

## Limits and review gates

- Default 5 creatures; maximum 20; maximum projected length 100 pages/slides
- More than 10 creatures are prompted in batches of 5
- Age is the poem-structure choice; stanza, line, rhyme, and word defaults are automatic
- Two optional poem iterations: the first retains the selected band and the second advances one band (12–14 remains 12–14)
- DOCX is mandatory and must be accepted before PPTX, PDF, or Canva
- Rework makes prior artifacts stale and requires a fresh design approval
- PDF/DOCX/PPTX preserve the canonical closing page when a non-empty closing note exists
- PPTX text remains editable; Kannada decks reference but do not embed `Noto Sans Kannada`
- A Canva success is recorded only when a real HTTPS edit URL and matching revision/page metadata are returned

See [Poem structure](docs/poem-structure.md), [Canonical BookDesign](docs/canonical-book-design.md), [DOCX](docs/docx-generation.md), [PPTX](docs/pptx-generation.md), [PDF](docs/pdf-generation.md), and [Canva handoff](docs/canva-handoff.md) for the detailed contracts.

## Privacy and security

- Book projects and exports are local unless the user explicitly consents to an external handoff.
- The server does not require a paid model API token, store Canva OAuth credentials, or upload files by itself.
- User source material is delimited as data-only in prompts; model output, paths, filenames, SVG, image files, and connector results are treated as untrusted.
- SVG is restricted to a non-executable shape/path allowlist. Raster assets are signature-, dimension-, checksum-, and containment-validated.
- The process has the same local permissions as the account that launches Claude Desktop. Choose a dedicated project directory and review every requested tool call.
- Do not commit project outputs, credentials, raw logs, local environment files, or machine-specific paths.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Architectural controls are summarized in [Architecture](docs/architecture.md).

## Troubleshooting

**The server or tools do not appear in Claude Desktop**

- Run `npm run build` and confirm `dist/server.js` exists.
- Validate the JSON and use an absolute server path.
- Completely quit and restart Claude Desktop.
- Inspect `%APPDATA%\Claude\logs` on Windows or `~/Library/Logs/Claude` on macOS.
- Run `node /absolute/path/to/dist/server.js` in a terminal. A healthy stdio server waits silently for an MCP client; startup errors should appear on stderr.

**`projectDir` is rejected**

Use an absolute path in MCP calls, such as `C:/Books/ocean-friends` or `/absolute/project/ocean-friends`. Relative paths are CLI-only.

**Export is blocked**

Ask for `get_delivery_summary` and follow `nextActions`. Common gates are unresolved content warnings, an incomplete illustration set, unapproved/stale HTML design, or an unaccepted DOCX.

**DOCX rework reports `docx_output_locked`**

Close the reviewed file in Word, LibreOffice, preview software, and sync tools, then retry. The original reviewed DOCX and rework allowances are preserved.

**Kannada PDF fails or glyphs are missing**

Set `BOOK_AGENT_KANNADA_FONT_PATH` in an uncommitted `.env` file to an appropriate Kannada-capable TTF. Install `Noto Sans Kannada` for DOCX/PPTX viewers and obtain fluent human language and glyph review.

**Canva is unavailable or asks for authorization**

Complete setup in the host adapter, rerun the readiness check, and consent only after local DOCX acceptance. This MCP never invents a Canva link.

## Release status

`v0.1.0-rc.1` is a planned release candidate, not an already-published npm package or GitHub release. Current automated and external gates are tracked in [Testing cycle](docs/testing-cycle.md) and [RC checklist](docs/release-checklist-v0.1.0-rc.1.md). Changes are summarized in [CHANGELOG.md](CHANGELOG.md).

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md). This project is available under the [MIT License](LICENSE).
