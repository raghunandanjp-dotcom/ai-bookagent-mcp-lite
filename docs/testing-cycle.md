# Testing cycle

This document is the project test inventory and execution log. Update the current
cycle after every meaningful test run so automated, visual, language, and external
connector checks remain distinguishable.

## Current cycle

| Field | Value |
| --- | --- |
| Cycle ID | `TC-2026-08-03-01` |
| Baseline commit | `aaf5fb14f25b7fb78826903a1de5a20e52fec2a6` |
| Branch | `main` |
| Started | 2026-08-03 (Asia/Calcutta) |
| Runtime | Node.js 24.14.1 on Windows |
| Overall status | In progress: automated and PDF gates pass; DOCX/PPTX visual and human QA remain |

## Test inventory

The normal release gate is `npm run check`. It compiles the TypeScript, verifies
the published CLI/server entrypoints, runs the complete Vitest suite, and scans
for non-portable user-specific paths.

| Area | Suite | Tests | What it covers |
| --- | --- | ---: | --- |
| Canva | `tests/canva.test.ts` | 12 | Readiness states, decline, consent, retry, Kannada payload, connector result validation |
| Workflow | `tests/workflow.test.ts` | 6 | Revisions, Canva mutations, rework limit, DOCX acceptance gates, age iteration, partial export failure |
| Content validation | `tests/validation.test.ts` | 6 | Creature coverage, fact review, approved creatures, page count, overflow, Kannada fields |
| Delivery summary | `tests/delivery-summary.test.ts` | 9 | Fact/language review status, next choices, totals, Canva decline and retry |
| DOCX and PDF export | `tests/exporters.test.ts` | 14 | Embedded media, alt metadata, digest reuse, forbidden-copy checks, DOCX structure and replacement, PDF tags/fonts/overflow/failure isolation |
| Illustration workflow | `tests/illustrations.test.ts` | 2 | Prompt slots, import metadata, approval gate, unsupported/corrupt asset rejection |
| PPTX export | `tests/pptx-export.test.ts` | 6 | Slide counts at 1/5/11/20 creatures, editability, metadata, accessibility, Kannada font warning |
| PPTX validation | `tests/pptx-validation.test.ts` | 6 | Age-band density boundaries, line/section overflow, Kannada font warning |
| Poem rules | `tests/poems.test.ts` | 7 | Age defaults, line normalization, repeated-stanza detection |
| Language | `tests/language.test.ts` | 4 | Kannada normalization, mixed Latin detection, digits/marks, English briefs for Kannada output |
| Project state | `tests/project.test.ts` | 4 | Mandatory DOCX, path containment, legacy manifests, malformed Canva state |
| Creature selection | `tests/selection.test.ts` | 3 | Batch size, alias reuse, regeneration limit |
| Core smoke | `scripts/smoke-core.mts` | 1 script | Representative end-to-end domain flow using the checked-in ocean example |
| DOCX render QA | `scripts/render-docx-qa.mjs` | 4 sizes | Generates 1/5/11/20-creature DOCX files and rasterizes them when LibreOffice and Poppler are present |
| PDF render QA | `scripts/render-pdf-qa.mjs` | 4 sizes | Generates 1/5/11/20-creature PDFs and rasterizes them when Poppler is present |
| PPTX render QA | `scripts/render-pptx-qa.mjs` | 4 sizes | Generates 1/5/11/20-creature decks and rasterizes them when LibreOffice and Poppler are present |

Vitest currently contains **79 automated tests across 12 suites**. The fixture
file `tests/fixtures/pptx-content.ts` supplies test data and is not a test suite.

## Execution log

| Run | Command or check | Result | Evidence / notes |
| --- | --- | --- | --- |
| R1 | `npm run check` | Blocked | Build and entrypoints passed; 63 tests in 10 suites passed. `tests/exporters.test.ts` could not load because the newly declared `pdfjs-dist` dependency was not installed locally after pulling the latest build. |
| R2 | `npm install --no-audit --no-fund` | Passed | Added 3 packages from the committed dependency definition; no tracked file changed. |
| R3 | `npm run check` | Passed | Build passed; entrypoints passed; 77/77 tests in 11/11 suites passed; portability scan passed. |
| R4 | `npm run test:smoke` | Failed | Expected page count 16 but received 17 at `scripts/smoke-core.mts:23`. The example has five creatures plus a non-empty closing note, so the documented current contract is `1 + (3 x 5) + 1 = 17`. This appears to be a stale smoke assertion. |
| R5 | Optional QA tool discovery | Partial | The bundled `pdftoppm.cmd` wrapper is present but points to a missing path. Its underlying Poppler executable is available and works when invoked directly. LibreOffice/`soffice` is not available, so PPTX/DOCX raster QA cannot run on this machine yet. |
| R6 | `npm run test:smoke` after correcting the stale assertion | Passed | The representative ocean-example domain flow completed successfully with the documented 17-page total. |
| R7 | `npm run check` after the smoke correction | Passed | Build, entrypoints, 77/77 tests, and portability all passed. |
| R8 | `npm run qa:pdf:render` plus direct bundled Poppler rasterization | Passed | Generated 1/5/11/20-creature PDFs and rendered exactly 4/16/34/61 PNG pages. The direct executable was used because the bundled command wrapper is miswired. |
| R9 | Representative PDF visual inspection | Passed | Reviewed all four section types in the 1-creature PDF and the cover, first poem, final fun-fact, and final activity pages in the 20-creature PDF. No clipping, overlap, broken characters, blank pages, footer collisions, or lost stanza breaks were observed. |
| R10 | `npm run check` for ENH-0008 | Passed | Build and entrypoints passed; 79/79 tests in 12/12 suites passed; portability scan passed. |
| R11 | `npm run test:smoke` for ENH-0008 | Passed | The ocean example produced the authoritative six illustration prompt slots: one cover plus five creatures. |
| R12 | DOCX/PPTX/PDF 1/5/11/20 fixture generation | Passed | Every format generated all four boundary sizes with embedded approved fixture artwork. DOCX/PPTX rasterization remains unavailable because LibreOffice is not installed. |
| R13 | Direct Poppler PDF rasterization and visual inspection | Passed | Rendered exactly 4/16/34/61 pages. Contact-sheet review covered all 115 pages; full-size review covered the complete 1-creature sequence and the last 20-creature page. Artwork remained proportional and unobstructed, text stayed searchable/visible, and no production labels appeared. |

## Findings and actions

| ID | Severity | Status | Finding | Next action |
| --- | --- | --- | --- | --- |
| `TST-001` | Low | Resolved | The core smoke script expected 16 pages for content whose closing note makes the correct total 17. | Updated the assertion to 17; the smoke script and full automated gate now pass. |
| `TST-002` | Medium | Open | LibreOffice is unavailable, preventing reference rendering of DOCX and PPTX outputs locally. | Run release-candidate visual QA on a machine with LibreOffice and Poppler, or install LibreOffice before that gate. |
| `TST-003` | Medium | Pending | Kannada content requires fluent human language review and rendered-glyph review. Automated script checks are necessary but insufficient. | Perform once on the final representative Kannada artifact, after automated checks pass. |
| `TST-004` | Medium | Pending | A real Canva handoff requires authorization, consent, edit-link validation, and visual review in Canva. | Perform one end-to-end handoff only after local artifact QA passes. |

## Lean test sequence for the Claude free tier

Use deterministic fixtures for boundary and failure testing. Claude should only
generate content where model behavior itself is under test.

1. **Every code change, no Claude usage:** run `npm run check`.
2. **After workflow or domain changes, no Claude usage:** run
   `npm run test:smoke` and the directly affected targeted suite.
3. **Before a release candidate, no Claude usage:** generate the 1/5/11/20-size
   PDF and PPTX QA fixtures. Structurally inspect every size; visually sample the
   cover, poem, fun-fact, activity, and final page/slide at the largest size.
4. **One English Claude generation:** use a five-creature, age 6-8 request as the
   representative happy path. Reuse the same accepted content for DOCX, PPTX,
   PDF, delivery summary, and optional Canva checks.
5. **One Kannada Claude generation:** use one creature to test native Kannada
   output, mixed-script rejection, fonts, and the human-review workflow. Do not
   spend Claude generations on 5/11/20-size Kannada boundaries; fixtures cover
   those mechanics.
6. **One real Canva handoff at most:** perform it only with the already-approved
   representative content after all local gates pass. Retry only for a confirmed
   connector failure, not for content variation.
7. **Rework and error paths:** use checked-in fixtures and automated tests rather
   than asking Claude for additional variations.

## Release-candidate tracker

| Gate | Status | Evidence required |
| --- | --- | --- |
| Clean dependency install | Passed | Lockfile-based install completes |
| TypeScript build | Passed | `npm run build` |
| Entrypoints | Passed | `npm run check:entrypoints` |
| Automated tests | Passed | 79/79 tests |
| Portability | Passed | `npm run check:paths` |
| Core smoke | Passed | Representative ocean-example flow passes with a 17-page total |
| PDF structural/render QA | Passed | 4/16/34/61 pages rendered; representative smallest and largest pages visually inspected |
| PPTX structural QA | Covered by automated tests | Slide/package assertions pass |
| PPTX visual QA | Blocked | Requires LibreOffice (`TST-002`) |
| DOCX visual QA | Blocked | Requires LibreOffice (`TST-002`) |
| English Claude happy path | Pending | One saved request/content/result set |
| Kannada language and glyph review | Pending | Fluent reviewer sign-off (`TST-003`) |
| Canva end-to-end | Pending | Consent record, matching HTTPS edit URL, visual review (`TST-004`) |

## Cycle completion record

When the cycle closes, record the date, final commit, disposition of every open
finding, artifact locations, human reviewers, and the release decision here.
