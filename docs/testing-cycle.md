# Testing cycle

This document is the project test inventory and execution log. Update the current
cycle after every meaningful test run so automated, visual, language, and external
connector checks remain distinguishable.

## Current cycle

| Field | Value |
| --- | --- |
| Cycle ID | `TC-2026-08-04-01` |
| Baseline commit | `c19d445ff6bc532bf73cecb9f3359f0394a30d59` plus ENH-0009 changes on the branch below |
| Branch | `codex/enh-0009-canonical-book-design` |
| Started | 2026-08-04 (Asia/Calcutta) |
| Runtime | Node.js 24.14.1 on Windows |
| Overall status | In progress: 92 automated tests and core smoke pass; ENH-0009 HTML/DOCX/PPTX visual QA, English/Kannada human QA, and Canva end-to-end remain |

## How to maintain this document

- Give every durable test case a stable ID. Do not reuse an ID after a test is retired.
- Append every meaningful execution to the execution log, including blocked runs and test-harness failures. Record product failures separately from environment or harness failures.
- When a test exposes a defect, add it to the defect and fix register, link the issue, and record the fixing PR and a one-line fix summary. Keep the defect row after resolution.
- Use `Passed`, `Failed`, `Blocked`, `Pending`, or `Not run` for test results. A blocked test is not a pass.
- Update the baseline commit and release-candidate tracker whenever a new release candidate is selected.

## Test inventory

The normal release gate is `npm run check`. It compiles the TypeScript, verifies
the published CLI/server entrypoints, runs the complete Vitest suite, and scans
for non-portable user-specific paths.

| Area | Suite | Tests | What it covers |
| --- | --- | ---: | --- |
| Canva | `tests/canva.test.ts` | 12 | Readiness states, decline, consent, retry, Kannada payload, connector result validation |
| Workflow | `tests/workflow.test.ts` | 8 | Revisions, idempotent selection persistence, Canva mutations, rework and lock behavior, DOCX acceptance gates, age iteration, partial export failure |
| Content validation | `tests/validation.test.ts` | 6 | Creature coverage, fact review, approved creatures, page count, overflow, Kannada fields |
| Delivery summary | `tests/delivery-summary.test.ts` | 9 | Fact/language review status, next choices, totals, Canva decline and retry |
| DOCX and PDF export | `tests/exporters.test.ts` | 16 | Embedded media, alt metadata, digest reuse, forbidden-copy checks, DOCX structure and replacement, both Windows lock errors, PDF tags/fonts/overflow/failure isolation |
| PPTX export | `tests/pptx-export.test.ts` | 6 | Slide counts at 1/5/11/20 creatures, editability, metadata, accessibility, Kannada font warning |
| PPTX validation | `tests/pptx-validation.test.ts` | 6 | Age-band density boundaries, line/section overflow, Kannada font warning |
| Poem rules | `tests/poems.test.ts` | 7 | Age defaults, line normalization, repeated-stanza detection |
| Language | `tests/language.test.ts` | 4 | Kannada normalization, mixed Latin detection, digits/marks, English briefs for Kannada output |
| Illustration workflow | `tests/illustrations.test.ts` | 4 | Prompt slots, import metadata, approval gate, unsupported/corrupt assets, missing/unexpected slots, digest and preview-tamper detection |
| Canonical design | `tests/design.test.ts` | 4 | SVG allowlist security, exact batch/local rasterization, canonical page plan, accessible offline HTML, public SVG-to-DOCX workflow |
| Project state | `tests/project.test.ts` | 5 | Mandatory DOCX, path containment, absolute MCP project directories, legacy manifests, malformed Canva state |
| Creature selection | `tests/selection.test.ts` | 5 | Batch size, alias reuse, regeneration limit, normalized idempotent retry, order-sensitive regeneration |
| Core smoke | `scripts/smoke-core.mts` | 1 script | Representative end-to-end domain flow using the checked-in ocean example |
| DOCX render QA | `scripts/render-docx-qa.mjs` | 4 sizes | Generates 1/5/11/20-creature DOCX files and rasterizes them when LibreOffice and Poppler are present |
| PDF render QA | `scripts/render-pdf-qa.mjs` | 4 sizes | Generates 1/5/11/20-creature PDFs and rasterizes them when Poppler is present |
| PPTX render QA | `scripts/render-pptx-qa.mjs` | 4 sizes | Generates 1/5/11/20-creature decks and rasterizes them when LibreOffice and Poppler are present |

Vitest currently contains **92 automated tests across 13 suites**. The fixture
file `tests/fixtures/pptx-content.ts` supplies test data and is not a test suite.

## Latest-change validation matrix

| Test ID | Change / risk | Test level | Expected result | Current result | Related defect or enhancement | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| `SEL-001` | Same ordered normalized creature IDs are retried | Unit | Original selection object, approval, history, and regeneration count are preserved | Passed in R17 | [#24](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/24), resolved | [PR #28](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/28): make identical submissions idempotent |
| `SEL-002` | Creature IDs are reordered | Unit | Submission is treated as a genuine regeneration | Passed in R17 | [#24](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/24), resolved | [PR #28](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/28) |
| `SEL-003` | Identical selection is submitted twice through persisted workflow | Integration | No revision, source revision, approval, history, or allowance changes | Passed in R17 | [#24](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/24), resolved | [PR #28](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/28) |
| `LOCK-001` | Atomic DOCX replacement returns `EPERM` | Integration | Stable `docx_output_locked`; original file and temporary-file hygiene preserved | Passed in R17 | [#25](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/25), resolved | [PR #29](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/29): translate Windows file-lock failures and preserve the reviewed file |
| `LOCK-002` | Atomic DOCX replacement returns `EACCES` | Integration | Same stable failure contract as `LOCK-001` | Passed in R17 | [#25](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/25), resolved | [PR #29](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/29) |
| `LOCK-003` | Rework fails because reviewed DOCX is locked | Workflow | Project revision, source revision, primary status, and both rework allowances remain unchanged | Passed in R17 | [#25](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/25), resolved | [PR #29](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/29) |
| `ILL-001` | Prompt, import, approval, and export gate | Workflow | One cover plus one asset per creature; export blocked until all are approved | Passed in R17 | [#26](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/26), completed | [PR #30](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/30): checksum-bound approved artwork across outputs |
| `ILL-002` | Unsupported or corrupt image | Negative integration | Import or export fails with a specific validation error | Passed in R17 | [#26](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/26), completed | [PR #30](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/30) |
| `ILL-003` | Missing, unexpected, or digest-mismatched approved set | Negative integration | Export fails before producing a document and identifies the invalid slot/state | Passed in R17 | [#26](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/26), completed | [PR #30](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/30) |
| `ILL-004` | DOCX/PPTX/PDF embed approved artwork | Structural integration | Correct media relationships, accessibility metadata, digest reuse, and no production labels | Passed in R17; PDF visual QA passed in R13 | [#26](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/26), completed | [PR #30](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/30) |
| `ILL-005` | Canva handoff references approved artwork | Contract | Exact checksum-bound assets and page references; no internal production copy | Passed in R17 | [#26](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/26), completed | [PR #30](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/30) |
| `ILL-006` | 1/5/11/20-creature output boundaries | Structural and visual | Deterministic DOCX/PPTX/PDF counts and proportional, unobstructed artwork | Automated and PDF visual passed; DOCX/PPTX visual blocked by `TST-002` | [#26](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/26), completed | [PR #30](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/30) |
| `DES-001` | Claude-authored SVG contains active, linked, embedded, text, or unsupported content | Security/unit | Strict rejection before any raster or manifest is accepted | Passed in R22 | [#32](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/32), in progress | PR pending: constrained allowlist and local `resvg` rasterization |
| `DES-002` | Complete code-native illustration set is submitted | Integration | Exact cover/creature slots, retained SVG provenance, checksum-bound local PNG, no external source path | Passed in R22 | [#32](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/32), in progress | PR pending: batch code-native illustration workflow |
| `DES-003` | Canonical design is rendered for review | Contract/unit | One page plan including closing page; offline fonts/assets and accessible alt text | Passed in R22 | [#32](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/32), in progress | PR pending: versioned `BookDesign` and HTML preview |
| `DES-004` | Content is reworked after DOCX review | Workflow | Old output becomes stale; new HTML design approval is required before DOCX regeneration | Passed in R22 | [#32](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/32), in progress | PR pending: source/design revision gate |
| `DES-005` | PPTX/PDF contain a closing note | Structural integration | Closing note appears as the same final canonical page used by HTML/DOCX | Passed in R22 | [#32](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/32), in progress | PR pending: cross-format page-plan parity |
| `CAN-009` | Faithful Canva handoff without template selection | Contract/workflow | Consent binds source/design/digest; payload uses canonical pages; success echoes parity metadata | Passed in R22; real connector pending | [#32](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/32), in progress | PR pending: faithful-by-default Canva contract |

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
| R14 | `npm test -- --run ...` from PowerShell | Blocked | Windows execution policy rejected `npm.ps1` before the project ran. Subsequent commands use `npm.cmd`; this is an environment launcher issue, not a product failure. |
| R15 | Targeted latest-change regression run through `npm.cmd` | Failed (test harness) | 49/50 product assertions passed. The new unexpected-slot setup attempted to use the public import API, which correctly rejected a creature outside the book before export validation. The test was corrected to inject a malformed persisted manifest at the validator boundary. |
| R16 | `npm.cmd test -- --run tests/illustrations.test.ts` after harness correction | Passed | 3/3 illustration workflow tests passed, including missing, unexpected, and digest-mismatch validation. |
| R17 | `npm.cmd run check` | Passed | TypeScript build, entrypoints, 87/87 tests across 12/12 suites, and portability scan passed. Includes PR #28, #29, and #30 regression coverage. |
| R18 | `npm.cmd run test:smoke` | Passed | Representative ocean-example domain flow passed after the expanded regression suite. |
| R19 | Existing English artifact eligibility check (`.claude-tests/cld-eng-01`) | Not reusable for current gate | The saved five-creature run predates ENH-0008 (`schemaVersion: 1.0`), has no approved-illustration manifest, and retains `needs_review` reader content. Its files remain preserved as historical evidence, but a current-baseline English run is still required. |
| R20 | First full Vitest run after introducing ENH-0009 gates | Failed (expected contract migration) | 69/87 passed; 18 assertions encoded the superseded export-before-design, mandatory Canva-template, and no-closing-page contracts. No new implementation defect was inferred from those expected failures. |
| R21 | Targeted contract migration run | Failed (test fixture) | 44/45 passed. The remaining workflow fixture omitted the newly required Canva parity metadata; the fixture was updated without weakening validation. |
| R22 | `npm.cmd run check` after ENH-0009 implementation and test migration | Passed | TypeScript build, entrypoints, 92/92 tests across 13/13 suites, and portability scan passed. |
| R23 | `npm.cmd run test:smoke` and `git diff --check` | Passed | Representative core smoke passed. Diff check found no whitespace errors; Git reported only the repository's normal LF-to-CRLF checkout notices. |
| R24 | Full gate after adding the SVG-to-DOCX public-flow test | Failed (test timing) | 90/92 passed. Two native `resvg` tests crossed Vitest's 5-second default while the full suite was running concurrently; both had passed in targeted runs and reported only timeout failures. Their explicit budgets were raised to 15 seconds, matching the existing export-test convention. |
| R25 | `npm.cmd run check` after native-raster timing correction | Passed | TypeScript build, entrypoints, 92/92 tests across 13/13 suites, and portability scan passed. The public code-native SVG → HTML approval → bound DOCX path passed end to end. |

## Findings and actions

| ID | Severity | Status | Finding | Next action |
| --- | --- | --- | --- | --- |
| `TST-001` | Low | Resolved | The core smoke script expected 16 pages for content whose closing note makes the correct total 17. | Updated the assertion to 17; the smoke script and full automated gate now pass. |
| `TST-002` | Medium | Open | LibreOffice is unavailable, preventing reference rendering of DOCX and PPTX outputs locally. | Run release-candidate visual QA on a machine with LibreOffice and Poppler, or install LibreOffice before that gate. |
| `TST-003` | Medium | Pending | Kannada content requires fluent human language review and rendered-glyph review. Automated script checks are necessary but insufficient. | Perform once on the final representative Kannada artifact, after automated checks pass. |
| `TST-004` | Medium | Pending | A real Canva handoff requires authorization, consent, edit-link validation, and visual review in Canva. | Perform one end-to-end handoff only after local artifact QA passes. |
| `TST-005` | Low | Pending | The existing English Claude artifact predates the mandatory approved-illustration workflow and cannot qualify as current release-candidate evidence. | Run one five-creature English happy path on the final baseline and retain its request, reviewed content, illustration approvals, manifest, and outputs. |

## Defect and fix register

| Defect / change | Status | Detected or covered by | Fix PR | Fix summary |
| --- | --- | --- | --- | --- |
| `TST-001`: stale smoke page count | Resolved | R4, R6 | [PR #22](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/22) | Correct the expected total to include the non-empty closing-note page. |
| [#24](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/24) / `BUG-0006`: identical selection retries consumed state | Resolved | `SEL-001` to `SEL-003` | [PR #28](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/28) | Compare ordered normalized IDs and return the existing state for a no-op retry. |
| [#25](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/25) / `BUG-0007`: locked DOCX rework surfaced a raw filesystem failure | Resolved | `LOCK-001` to `LOCK-003` | [PR #29](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/29) | Convert `EPERM`/`EACCES` to an actionable stable error without changing the file or project state. |
| [#26](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/26) / `ENH-0008`: final outputs lacked approved illustrations | Completed | `ILL-001` to `ILL-006` | [PR #30](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/pull/30) | Add reviewed, checksum-bound artwork and reuse it across DOCX, PPTX, PDF, and Canva. |
| [#32](https://github.com/raghunandanjp-dotcom/ai-bookagent-mcp-lite/issues/32) / `ENH-0009`: external image generation/path dependency blocked the normal Claude workflow | In progress | `DES-001` to `DES-005`, `CAN-009`, CLD-ENG-003 | PR pending | Add constrained code-native SVG, canonical HTML-first `BookDesign`, one batch design approval, bound exports, and faithful Canva reproduction. Rationale is recorded in `docs/canonical-book-design.md`. |
| `TST-002`: DOCX/PPTX reference rendering unavailable locally | Open | `ILL-006` | None | Install/use LibreOffice and run both visual QA scripts before release. |
| `TST-003`: Kannada human language and glyph validation outstanding | Pending | Release gate | None | Obtain fluent reviewer sign-off on the final representative artifact. |
| `TST-004`: real Canva authorization and edit-link flow outstanding | Pending | Release gate | None | Complete one consented end-to-end connector handoff and visual review. |
| `TST-005`: prior English artifact is not current-baseline evidence | Pending | R19 | None | Repeat the English happy path after ENH-0008 and complete content/art review. |

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
| Automated tests | Passed | 92/92 tests |
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
