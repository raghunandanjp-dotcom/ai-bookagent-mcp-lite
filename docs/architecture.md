# Architecture

## Principles

1. Offline-first deterministic core.
2. Host-assisted model generation.
3. Canonical HTML-first design review.
4. DOCX-first delivery and explicit acceptance.
5. Optional PPTX/PDF only after current DOCX acceptance.
6. Optional advanced local Canva Connect binary import with explicit per-book consent.
7. Portable, resumable, versioned project packages.

## Components

- `domain.ts`: canonical schemas and hard limits.
- `selection.ts`: canonical IDs, alias-aware deduplication, regeneration history, and batching.
- `prompts.ts`: FullPipelineV3-inspired host prompt packages.
- `poems.ts`: canonical age defaults, iteration progression, normalization, and structural analysis.
- `validation.ts`: schema, coverage, page, word, language, and review checks.
- `project.ts`: atomic manifest persistence, provenance, paths, and checksums.
- `illustrations.ts`: host-assisted prompt packaging, PNG/JPEG inspection, project-local import, content digests, and final approved-set resolution.
- `svg-illustrations.ts`: constrained SVG validation, exact-set batching, local `resvg` rasterization, and code-native provenance.
- `design.ts`: canonical page plan, design/source/illustration revision binding, and local HTML preview rendering.
- `exporters.ts`: DOCX-first export orchestration plus deterministic illustrated DOCX, editable age-profiled illustrated PPTX, and fixed-page illustrated PDF creation. Optional failures are isolated from successful artifacts.
- `canva.ts`: persisted Canva result and URL validation.
- `canva-connect.ts`: local-only OAuth PKCE, fail-closed OS-vault boundary, canonical-PPTX regeneration, and direct binary import.
- `workflow.ts`: stateful orchestration.
- `server.ts`: MCP tools.
- `cli.ts`: local testing and automation.

## Trust boundaries

Claude output is untrusted input until schema and coverage validation succeeds. User-provided reference material is placed inside a data-only delimiter. Canva API results are untrusted until their design identifier, HTTPS Canva edit path, and matching URL identifier validate.

MCP has no Canva credential or import tool. The optional local CLI performs the direct API call only after explicit consent and only from a freshly generated, checksum-bound PPTX. It does not accept a user PPTX, public URL, template, redesign prompt, or host file reference.

OAuth credentials are handled only by the advanced local CLI and never persist in a project, MCP payload, log, or output. Windows uses Credential Manager through a fixed PowerShell P/Invoke helper; Linux uses libsecret. Unsupported vault environments fail closed.

## Project state

The manifest stores bookkeeping `revision`, canonical `sourceRevision`, versioned `BookDesign`, its `designRevision`, and an illustration-set digest, plus request, selection history, content, illustration records, output checksums, DOCX acceptance, rework count, and Canva state. Exports retain all three canonical bindings, so older artifacts are stale rather than silently current.

The HTML preview is reviewed before any document export. One approval covers the complete page plan and exact illustration set. The DOCX primary output is then reviewed before secondary work begins. Up to two reworks may replace content; each increments `sourceRevision`, clears acceptance, refreshes the HTML design preview, and requires new design approval before DOCX regeneration. Local Canva Connect is available only for an accepted DOCX bound to the approved design. Any changed bound value requires new consent.

DOCX is the blocking local artifact. Its logical page sequence is one cover, three explicit pages per creature (poem, fun fact, activity), and an optional closing page. Validation, delivery summaries, and the exporter share this page-count contract. The exporter writes a temporary package before publishing the final filename, preserves source order and poem stanza/line boundaries, and records a digest only after publication.

DOCX layout uses A4 portrait pages with 0.75-inch margins, real heading levels, effective-age typography, and embedded approved artwork with non-visible OOXML alternative text. The cover owns one approved asset; every creature owns one approved asset reused across its three pages. Reference rendering through LibreOffice/Poppler is a QA workflow rather than a runtime dependency. Renderer-specific pagination is controlled through conservative preflight limits and verified renders rather than assumed to be pixel-identical across Word processors.

Full creature-list regeneration is limited to two usable results after the initial selection. Malformed output and targeted duplicate replacement are repairs, not consumed regeneration attempts.

Poem iteration is a separate ledger: iteration one keeps the selected age band and iteration two uses the next band, with 12–14 capped at 12–14. The poem contract is upstream of exporter-specific work in issues #9–#12; those tasks must preserve poem semantics and intentional breaks rather than redefine them.

## Illustration trust boundary

Illustration prompts are production metadata and never enter reader-facing exports. An imported file remains pending until explicit review. Final export resolves exactly one approved cover slot and one approved slot per current creature, verifies that no unexpected slots exist, reopens every file, checks its signature, dimensions, MIME type, byte count, and digest, and fails with an actionable validation error on any mismatch. Asset files are fitted proportionally; formats may change layout but may not substitute or regenerate the underlying approved bytes.

## Future extensions

The MVP implements only creature poetry activity books. Independent stories, connected narratives, other book types, direct model providers, and a general-user hosted Canva integration remain versioned future extensions.

PPTX reliability is split into deterministic OOXML inspection in the automated test suite and optional local rendering with LibreOffice and Poppler. Structural tests are required in CI; rendered visual review covers representative 1-, 5-, 11-, and 20-creature decks without committing platform-dependent bitmap baselines.
