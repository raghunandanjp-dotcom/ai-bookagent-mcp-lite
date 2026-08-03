# Architecture

## Principles

1. Offline-first deterministic core.
2. Host-assisted model generation.
3. DOCX-first delivery.
4. DOCX-first review and explicit acceptance.
5. Optional PPTX/PDF only after current DOCX acceptance.
6. Design selection and explicit consent before Canva.
7. Portable, resumable, versioned project packages.

## Components

- `domain.ts`: canonical schemas and hard limits.
- `selection.ts`: canonical IDs, alias-aware deduplication, regeneration history, and batching.
- `prompts.ts`: FullPipelineV3-inspired host prompt packages.
- `poems.ts`: canonical age defaults, iteration progression, normalization, and structural analysis.
- `validation.ts`: schema, coverage, page, word, language, and review checks.
- `project.ts`: atomic manifest persistence, provenance, paths, and checksums.
- `exporters.ts`: DOCX-first export orchestration plus deterministic DOCX, editable age-profiled PPTX, and fixed-page PDF creation. Optional failures are isolated from successful artifacts.
- `canva.ts`: readiness, consent, handoff, and URL validation.
- `workflow.ts`: stateful orchestration.
- `server.ts`: MCP tools.
- `cli.ts`: local testing and automation.

## Trust boundaries

Claude output is untrusted input until schema and coverage validation succeeds. User-provided reference material is placed inside a data-only delimiter. Canva connector results are untrusted until their discriminated result schema, design identifier, HTTPS Canva design path, and matching URL identifier validate.

The core has no Canva SDK or tool-name dependency. It emits a neutral handoff contract; the host-owned adapter handles connector discovery, authorization, invocation, and translation back to the neutral success/failure result.

OAuth credentials are never handled or stored by this project.

## Project state

The manifest stores both a bookkeeping `revision` and canonical `sourceRevision`, plus the project request, selection history, content, output checksums, DOCX acceptance, rework count, and Canva state. Exports retain the source revision that produced them, so older artifacts can be reported as stale instead of silently treated as current.

The DOCX primary output is reviewed before secondary work begins. Up to two reworks may replace the canonical content and regenerate DOCX. The first warns that one rework remains; the second warns that none remain. Every rework increments `sourceRevision`, clears primary acceptance, and invalidates Canva state. PPTX and PDF are independent optional outputs. Canva is available only for an accepted DOCX at the current source revision and requires an explicit design selection before consent.

Canva readiness distinguishes missing setup from missing authorization. Declines and connector failures are persisted. Retryable failures retain consent only for the unchanged selected design and source revision; rechecking readiness or changing canonical inputs returns the workflow to a fresh consent boundary.

DOCX is the blocking local artifact. Its logical page sequence is one cover, three explicit pages per creature (poem, fun fact, activity), and an optional closing page. Validation, delivery summaries, and the exporter share this page-count contract. The exporter writes a temporary package before publishing the final filename, preserves source order and poem stanza/line boundaries, and records a digest only after publication.

DOCX layout uses A4 portrait pages with 0.75-inch margins, real heading levels, effective-age typography, visible accessible illustration descriptions, and local-only generation. Reference rendering through LibreOffice/Poppler is a QA workflow rather than a runtime dependency. Renderer-specific pagination is controlled through conservative preflight limits and verified renders rather than assumed to be pixel-identical across Word processors.

Full creature-list regeneration is limited to two usable results after the initial selection. Malformed output and targeted duplicate replacement are repairs, not consumed regeneration attempts.

Poem iteration is a separate ledger: iteration one keeps the selected age band and iteration two uses the next band, with 12–14 capped at 12–14. The poem contract is upstream of exporter-specific work in issues #9–#12; those tasks must preserve poem semantics and intentional breaks rather than redefine them.

## Future extensions

The MVP implements only creature poetry activity books. Independent stories, connected narratives, other book types, direct model providers, image generation, and native Canva automation remain versioned future extensions.

PPTX reliability is split into deterministic OOXML inspection in the automated test suite and optional local rendering with LibreOffice and Poppler. Structural tests are required in CI; rendered visual review covers representative 1-, 5-, 11-, and 20-creature decks without committing platform-dependent bitmap baselines.
