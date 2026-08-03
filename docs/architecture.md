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

The manifest stores both a bookkeeping `revision` and canonical `sourceRevision`, plus the project request, selection history, content, output checksums, DOCX acceptance, rework count, and Canva state. Exports retain the source revision that produced them, so older artifacts can be reported as stale instead of silently treated as current.

The DOCX primary output is reviewed before secondary work begins. Up to two reworks may replace the canonical content and regenerate DOCX. The first warns that one rework remains; the second warns that none remain. Every rework increments `sourceRevision`, clears primary acceptance, and invalidates Canva state. PPTX and PDF are independent optional outputs. Canva is available only for an accepted DOCX at the current source revision and requires an explicit design selection before consent.

Full creature-list regeneration is limited to two usable results after the initial selection. Malformed output and targeted duplicate replacement are repairs, not consumed regeneration attempts.

## Future extensions

The MVP implements only creature poetry activity books. Independent stories, connected narratives, other book types, direct model providers, image generation, and native Canva automation remain versioned future extensions.
