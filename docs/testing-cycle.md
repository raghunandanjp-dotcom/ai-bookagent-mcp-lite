# Testing cycle

This is the release test inventory and evidence log. Automated structure checks, rendered visual checks, human review, connector checks, and publication actions are independent gates. `Blocked` and `Pending` never mean `Passed`.

## Current cycle

| Field | Value |
| --- | --- |
| Cycle ID | `TC-2026-08-10-RC1` |
| Target | `v0.1.0-rc.1` |
| Merged baseline | `9437a9d118eec8856a02c6727b50a0819b31311e` (`main`, PR #35 / RC-readiness merged) |
| Working branch | `agent/p2-kannada-canva-qualification` |
| Started | 2026-08-10 (Asia/Calcutta) |
| Runtime | Windows; Node.js 24.14.1 |
| Overall status | In progress: local install, 93-test automated gate, smoke, boundary generation, and PDF visual QA pass; DOCX/PPTX rendering, current English/Kannada human evidence, Canva, and publication gates remain open |

The previous cycle ended with `npm.cmd run check` passing 92/92 tests at the ENH-0009 branch tip (R25 in the prior log). That is useful merged-baseline history, but it is not substituted for a final run on the RC candidate commit.

## Evidence rules

- Give every durable test case a stable ID and retain defect history after resolution.
- Log meaningful executions, including environment failures, harness failures, timeouts, and blocked checks.
- Record artifact generation separately from application rendering and visual inspection.
- Update the baseline and candidate commit whenever the selected RC changes.
- Do not commit `.claude-tests`, `.docx-qa`, `.pptx-qa`, `.pdf-qa`, or other generated project/output directories.

## Automated inventory

The normal code gate is `npm run check`: TypeScript build, published entrypoint verification, the complete Vitest suite, and the portability scan.

| Area | Suite | Tests | Coverage |
| --- | --- | ---: | --- |
| Canva | `tests/canva.test.ts` | 13 | Readiness, consent/decline/retry, Kannada payload, parity/result validation, explicit edit-path enforcement |
| Workflow | `tests/workflow.test.ts` | 8 | Revisions, selection idempotency, rework/locks, design and DOCX gates, partial export failure |
| Content validation | `tests/validation.test.ts` | 6 | Coverage, facts/review flags, page/word/overflow limits, Kannada fields |
| Delivery summary | `tests/delivery-summary.test.ts` | 9 | Review status, totals, artifacts, Canva next actions |
| DOCX/PDF exporters | `tests/exporters.test.ts` | 16 | Media/accessibility, typography, page structure, replacement locks, PDF fonts/overflow/isolation |
| PPTX export | `tests/pptx-export.test.ts` | 6 | 1/5/11/20 sizes, editable text, accessibility, Kannada warning |
| PPTX validation | `tests/pptx-validation.test.ts` | 6 | Density, overflow, Kannada warning |
| Poem rules | `tests/poems.test.ts` | 7 | Age defaults, line normalization, repeated stanzas |
| Language | `tests/language.test.ts` | 4 | Kannada normalization/script validation and English source briefs |
| Illustrations | `tests/illustrations.test.ts` | 4 | Prompt/import/approval gates, invalid/tampered assets and previews |
| Canonical design | `tests/design.test.ts` | 4 | SVG security/rasterization, page plan, accessible offline HTML, public SVG-to-DOCX flow |
| Project state | `tests/project.test.ts` | 5 | Mandatory DOCX, containment/absolute MCP paths, legacy and malformed state |
| Selection | `tests/selection.test.ts` | 5 | Batch/reuse/regeneration/idempotency/order rules |

Vitest contains **93 tests across 13 suites**. `scripts/smoke-core.mjs` adds one representative domain-flow smoke script.

## Structural and render inventory

| Harness | Boundary artifacts | Current expected sequence | Rendering dependency |
| --- | --- | --- | --- |
| `npm run qa:docx:render` | DOCX at 1/5/11/20 creatures | 4/16/34/61 logical pages; fixture has no closing note | LibreOffice + Poppler |
| `npm run qa:pptx:render` | PPTX at 1/5/11/20 creatures | 5/17/35/62 slides; fixture has a closing note | LibreOffice + Poppler |
| `npm run qa:pdf:render` | PDF at 1/5/11/20 creatures | 5/17/35/62 pages; fixture has a closing note | Poppler |

The HTML-first design and exporters include the closing page when `closingNote` is non-empty. The PPTX/PDF harness expectations were stale at 4/16/34/61 on the merged baseline and are corrected in this RC-readiness change. This is a harness correction, not evidence that rendered output passed.

## Current execution log

| Run | Command or check | Result | Evidence / notes |
| --- | --- | --- | --- |
| RC1-R1 | Baseline/branch inspection | Passed | `HEAD`, `origin/main`, and local `main` all resolved to merged commit `5b4a293`; isolated P1 branch created. |
| RC1-R2 | LibreOffice/Poppler discovery | Partial | No `soffice`/LibreOffice on PATH or in standard Windows install paths. Bundled Poppler 26.05.0 executables exist; the wrapper path is miswired, so direct executable invocation is required locally. |
| RC1-R3 | `.claude-tests/cld-eng-04` read-only inspection | Historical only | Visible outside this worktree: `book-project.json` and one authoring prompt package. Schema 1.2 project is at revision 4/source revision 3 and stage `content_review_required`; illustrations and exports are empty. No newer evidence exists there. |
| RC1-R4 | Initial `npm.cmd run check` | Blocked | Fresh worktree had no `node_modules`; build could not find `tsc`. Product tests did not run. |
| RC1-R5 | `npm.cmd ci --no-audit --no-fund` | Passed | 196 packages installed from the committed lockfile; no package or lockfile edit. |
| RC1-R6 | `npm.cmd run check` after install | Failed (transient test timing) | Build and entrypoints passed; 91/92 tests passed. One PDF exporter test exceeded Vitest's 5-second default at 5.35 seconds during the full concurrent run. |
| RC1-R7 | `npm.cmd test -- --run tests/exporters.test.ts` | Passed | 16/16 exporter tests passed; the previously timed-out PDF case completed in 1.45 seconds. Final full gate still required. |
| RC1-R8 | `npm.cmd run test:smoke` | Passed | Representative core flow completed. |
| RC1-R9 | DOCX/PPTX/PDF boundary harnesses on merged baseline | Partial | All 12 files generated. DOCX/PPTX did not render without LibreOffice. PDF harness did not render because its Poppler wrapper probe failed; direct Poppler remains available. Manifests exposed stale PPTX/PDF closing-page expectations. |
| RC1-R10 | Corrected boundary harness rerun and direct Poppler render | Passed/partial | DOCX generated 4/16/34/61-page fixtures and PPTX generated 5/17/35/62-slide fixtures; neither rendered without LibreOffice. PDF rendered exactly 5/17/35/62 pages through direct Poppler. |
| RC1-R11 | PDF visual inspection | Passed | Contact sheets covered all 119 pages. Full-size review covered the complete 1-creature cover/poem/fact/activity/closing sequence and the 20-creature closing page. No clipping, overlap, broken text, blank pages, footer collision, distorted artwork, or sequence gap observed. |
| RC1-R12 | Local Markdown target check | Passed | Every relative link target across 14 Markdown files exists. External publication links are not represented as completed releases. |
| RC1-R13 | Two pre-final `npm.cmd run check` attempts | Failed (documentation portability) | Both reached 92/92 passing tests; portability then rejected realistic user-home path examples in README. Examples were replaced with neutral absolute placeholders. |
| RC1-R14 | Final `npm.cmd run check` | Passed | TypeScript build, entrypoints, 92/92 tests across 13/13 suites, and portability scan all passed. |
| RC1-R15 | Targeted Kannada/Canva contract run | Passed | 68/68 tests across 8 suites passed. This is automated structural evidence only; no fluent reviewer, Kannada render, or Canva connector was exercised. |
| RC1-R16 | P2 DOCX/PPTX fixture generation | Partial | All English 1/5/11/20 fixtures generated. Rendering remained blocked without LibreOffice, and `BOOK_AGENT_KANNADA_FONT_PATH` was unset, so this provides no Kannada glyph evidence. |
| RC1-R17 | `npm.cmd run check` after merging current `main` into P2 | Passed | TypeScript build, entrypoints, 93/93 tests across 13/13 suites, and portability scan all passed. |

## Merged latest-change coverage

| ID | Risk | Automated expectation | Baseline evidence | External remainder |
| --- | --- | --- | --- | --- |
| `SEL-001` | Identical/reordered selection retries | No-op identical retry; reorder consumes regeneration | Covered by 92-test suite; fixes merged in PR #28 | None |
| `LOCK-001` | Windows DOCX lock during replacement/rework | Stable error; original file/state/allowances preserved | Covered by suite; fix merged in PR #29 | Manual messaging may be sampled |
| `ILL-001` | Incomplete, corrupt, changed, or mismatched artwork | Block before export; exact checksums/slots | Covered by suite; ENH-0008 merged in PR #30 | Human art/accessibility review |
| `DES-001` | Executable/linked/embedded SVG | Strict allowlist rejection before acceptance | Covered by suite; ENH-0009 merged in PR #33 | None |
| `DES-002` | Stale/mutated HTML design | Source/design/digest binding blocks approval/export | Covered by suite; ENH-0009 merged in PR #33 | Current HTML visual approval |
| `DES-003` | Cross-format page-plan divergence | Canonical cover/sections/optional closing page | Structural tests pass; harness count correction in this change | DOCX/PPTX reference render |
| `CAN-009` | Canva result does not match approved design or return an explicit edit URL | Consent, exact parity metadata, and `/design/{designId}/edit` required | 13 contract tests pass | Real authorized connector, edit access, and visual review |

## Findings and blockers

| ID | Severity | Status | Finding | Required disposition |
| --- | --- | --- | --- | --- |
| `RC-TST-001` | Medium | Open | DOCX/PPTX reference rendering is unavailable locally because LibreOffice is absent. | Run both RC harnesses on a machine with LibreOffice and Poppler; inspect all section types and largest final page/slide. |
| `RC-TST-002` | Low | Resolved | PPTX/PDF harnesses used pre-ENH-0009 counts despite non-empty closing notes. | Corrected and verified at 5/17/35/62 in RC1-R10. |
| `RC-TST-003` | Low | Resolved for this cycle | One PDF test timed out only in the first concurrent full suite and passed immediately in isolation. | Final clean 92/92 run passed; monitor for recurrence without claiming a product defect. |
| `RC-TST-004` | Medium | Pending | No current-baseline English end-to-end human-reviewed artifact exists. `cld-eng-04` stops at `content_review_required`. | Complete one five-creature English run through design/DOCX/secondary-output review without committing the project. |
| `RC-TST-005` | Medium | Pending | Kannada automation cannot establish linguistic quality or glyph rendering. | Complete [`KAN-ACC-001`](experimental-qualification.md#kannada-acceptance-kan-acc-001) on the final representative artifact. |
| `RC-TST-006` | Medium | Pending | Real Canva authorization, consent, edit URL, parity, and visual behavior are untested. | Complete [`CAN-ACC-001`](experimental-qualification.md#real-canva-acceptance-can-acc-001) after local gates. |
| `RC-TST-007` | Release | Pending approval | Repository visibility, reviewer invitation, tag, GitHub release, and npm publication are maintainer-controlled external actions. | Follow the exact ordered steps in the RC checklist only after explicit approval. |

## Release-candidate tracker

| Gate | Status | Current evidence / next action |
| --- | --- | --- |
| Lockfile-based local install | Passed | RC1-R5 |
| TypeScript build and entrypoints | Passed | RC1-R17 |
| Automated 93-test suite | Passed | 93/93 across 13 suites in RC1-R17 |
| Portability scan | Passed | RC1-R17 |
| Core smoke | Passed | RC1-R8 |
| Boundary artifact generation | Passed | RC1-R9; regenerate after harness correction |
| PDF Poppler render/visual QA | Passed | 5/17/35/62 pages; all 119 scanned plus full-size representatives in RC1-R10/R11 |
| DOCX visual QA | Blocked | `RC-TST-001` |
| PPTX visual QA | Blocked | `RC-TST-001` |
| English Claude happy path | Pending | `RC-TST-004` |
| Kannada human review | Pending | `RC-TST-005` |
| Canva end-to-end | Pending | `RC-TST-006` |
| Public visibility/reviewer/tag/release/npm | Pending explicit approval | `RC-TST-007`; see [RC checklist](release-checklist-v0.1.0-rc.1.md) |

## Lean final sequence

1. Run `npm run check` and `npm run test:smoke` on the candidate commit.
2. Generate all 1/5/11/20 format fixtures; structurally verify counts and packages.
3. Render PDF locally with Poppler and inspect every page by contact sheet plus representative full-size pages.
4. Render DOCX/PPTX on a LibreOffice + Poppler machine and record exact page/slide counts and visual inspection.
5. Run one five-creature English Claude happy path and complete the one-creature [`KAN-ACC-001`](experimental-qualification.md#kannada-acceptance-kan-acc-001) procedure.
6. Run Canva once using [`CAN-ACC-001`](experimental-qualification.md#real-canva-acceptance-can-acc-001), only after local acceptance and explicit consent.
7. Record candidate commit, artifacts, reviewers, every blocker disposition, and the go/no-go decision in the [RC checklist](release-checklist-v0.1.0-rc.1.md).
