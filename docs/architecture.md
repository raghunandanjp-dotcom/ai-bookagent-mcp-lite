# Architecture

## Principles

1. Offline-first deterministic core.
2. Host-assisted model generation.
3. DOCX-first delivery.
4. Optional exports before external handoffs.
5. Explicit consent before Canva.
6. Portable, resumable, versioned project packages.

## Components

- `domain.ts`: canonical schemas and hard limits.
- `selection.ts`: canonical IDs, alias-aware deduplication, regeneration history, and batching.
- `prompts.ts`: FullPipelineV3-inspired host prompt packages.
- `poems.ts`: canonical age defaults, iteration progression, normalization, and structural analysis.
- `validation.ts`: schema, coverage, page, word, language, and review checks.
- `project.ts`: atomic manifest persistence, provenance, paths, and checksums.
- `exporters.ts`: deterministic DOCX, PPTX, and PDF creation.
- `canva.ts`: readiness, consent, handoff, and URL validation.
- `workflow.ts`: stateful orchestration.
- `server.ts`: MCP tools.
- `cli.ts`: local testing and automation.

## Trust boundaries

Claude output is untrusted input until schema and coverage validation succeeds. User-provided reference material is placed inside a data-only delimiter. Canva connector results are untrusted until the design identifier and Canva-domain URL validate.

OAuth credentials are never handled or stored by this project.

## Project state

The manifest stores the project ID, revision, request, creature-selection history, cumulative exclusions, content, export checksums, and Canva status. Reopening a project does not reset its regeneration count.

DOCX is the blocking local artifact. Its logical page sequence is one cover, three explicit pages per creature (poem, fun fact, activity), and an optional closing page. Validation, delivery summaries, and the exporter share this page-count contract. The exporter writes a temporary package before publishing the final filename, preserves source order and poem stanza/line boundaries, and records a digest only after publication.

DOCX layout uses A4 portrait pages with 0.75-inch margins, real heading levels, effective-age typography, visible accessible illustration descriptions, and local-only generation. Reference rendering through LibreOffice/Poppler is a QA workflow rather than a runtime dependency. Renderer-specific pagination is controlled through conservative preflight limits and verified renders rather than assumed to be pixel-identical across Word processors.

Full creature-list regeneration is limited to two usable results after the initial selection. Malformed output and targeted duplicate replacement are repairs, not consumed regeneration attempts.

Poem iteration is a separate ledger: iteration one keeps the selected age band and iteration two uses the next band, with 12–14 capped at 12–14. The poem contract is upstream of exporter-specific work in issues #9–#12; those tasks must preserve poem semantics and intentional breaks rather than redefine them.

## Future extensions

The MVP implements only creature poetry activity books. Independent stories, connected narratives, other book types, direct model providers, image generation, and native Canva automation remain versioned future extensions.
