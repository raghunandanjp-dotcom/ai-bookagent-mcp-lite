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
- `validation.ts`: schema, coverage, page, word, language, and review checks.
- `project.ts`: atomic manifest persistence, provenance, paths, and checksums.
- `exporters.ts`: deterministic DOCX, PPTX, and PDF creation. PPTX uses age-band layout profiles and editable Office text/shapes.
- `canva.ts`: readiness, consent, handoff, and URL validation.
- `workflow.ts`: stateful orchestration.
- `server.ts`: MCP tools.
- `cli.ts`: local testing and automation.

## Trust boundaries

Claude output is untrusted input until schema and coverage validation succeeds. User-provided reference material is placed inside a data-only delimiter. Canva connector results are untrusted until the design identifier and Canva-domain URL validate.

OAuth credentials are never handled or stored by this project.

## Project state

The manifest stores the project ID, revision, request, creature-selection history, cumulative exclusions, content, export checksums, and Canva status. Reopening a project does not reset its regeneration count.

Full creature-list regeneration is limited to two usable results after the initial selection. Malformed output and targeted duplicate replacement are repairs, not consumed regeneration attempts.

## Future extensions

The MVP implements only creature poetry activity books. Independent stories, connected narratives, other book types, direct model providers, image generation, and native Canva automation remain versioned future extensions.

PPTX reliability is split into deterministic OOXML inspection in the automated test suite and optional local rendering with LibreOffice and Poppler. Structural tests are required in CI; rendered visual review covers representative 1-, 5-, 11-, and 20-creature decks without committing platform-dependent bitmap baselines.
