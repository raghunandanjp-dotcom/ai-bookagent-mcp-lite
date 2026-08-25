# MCP tool contracts

## `create_book_project`

Creates the manifest from a theme, title, age band, language, creature count, brief, and requested export formats. `projectDir` must be an absolute path selected by the host; relative paths are rejected before any filesystem mutation so the MCP host's working directory cannot affect the destination. Interactive creation requires explicit age and language choices after the initial natural-language prompt. Kannada is presented as experimental and requiring fluent human review and discretion; the user's prompt may remain in English. DOCX is inserted even when omitted.

## `set_creature_selection`

Sets the initial list or consumes one of two full-list regenerations. A retry with `excludePrevious: false` is idempotent when its ordered sequence of creature IDs matches the current sequence after ID normalization; it does not change approval, history, revisions, or the regeneration allowance. Creature order is significant, so reordering IDs is a regeneration. `excludePrevious` applies the cumulative no-reuse ledger. Alias collisions are rejected.

## `approve_creature_selection`

Locks a non-empty reviewed selection.

## `prepare_authoring_prompt`

Produces host-assisted prompt batches. More than ten creatures are split into groups of five.

## `reiterate_authoring_prompt`

Produces at most two further prompt packages without another user choice. Iteration one uses the selected age; iteration two uses the next age band, capped at 12–14. This counter is independent from creature-list regeneration.

## `validate_book_content`

Validates schema, approved-creature coverage, duplicates, unexpected creatures, poem title/age/stanza/line/rhyme declarations, adjacent stanza repetition, requested and section language, each generated Kannada reader-facing field, mixed script, age-band DOCX and PPTX overflow limits, projected pages, total words, and review flags. User prompts and illustration briefs may remain in English as production metadata, but exporters never render them. Presentation overflow is blocking rather than silently shrunk or paginated.

## `prepare_illustration_prompts`

Creates a project-local prompt package with a single shared art direction, one cover prompt, and one prompt per selected creature. This is host-assisted and provider-neutral: the MCP does not call or require a paid image-generation API.

## `import_illustration_asset`

Imports either host-generated or user-supplied PNG/JPEG artwork into `assets/illustrations`. It identifies the required cover or creature slot and persists signature-derived MIME type and dimensions, byte count, SHA-256 digest, alternative text, source, provenance, and licensing data. Files larger than 15 MiB, unsupported/corrupt files, dimensions above 20,000 pixels, or images below the print-fit minimum of 600 pixels on the long edge and 350 pixels on the short edge are rejected. Import does not imply approval.

## `import_code_native_illustration_set`

Accepts exactly one cover and one creature SVG for every current creature in a single batch. Only a constrained shape/path subset is allowed. Scripts, event handlers, links, remote or embedded resources, text, styling blocks, and unsupported elements or attributes are rejected. Sanitized SVG sources are retained and rasterized locally with `resvg`; checksum-bound PNG records use `source: code_native`. This is the preferred self-contained path and does not depend on a host image connector or user-managed source paths.

## `create_book_design_preview`

Builds the versioned canonical `BookDesign`, binds it to the current source revision and illustration-set digest, copies local fonts, and writes `previews/book-design.html` plus `design/book-design.json`. The complete asset set is integrity-checked, but may remain pending because the preview is the approval artifact.

## `approve_book_design`

Records one explicit review of the HTML book design and batch-approves every exact illustration displayed in it. Stale source revisions, changed illustration digests, missing files, or corrupt files block approval. This gate unlocks all exporters.

## `review_illustration_asset`

Approves or rejects one imported asset and records the reviewer, time, and optional note. Re-importing a slot replaces its manifest record and returns it to pending review. Exactly one approved cover and one approved asset per current creature are required for export.

## `create_document_exports`

Creates DOCX by default from the approved current `BookDesign`. Before writing anything, it verifies source revision, design revision, illustration-set digest, page plan, and the complete approved illustration set on disk. The primary DOCX is mandatory and must be accepted before PPTX or PDF can be created independently for the same bound design. Export records retain all three bindings so stale artifacts cannot be treated as current.

## `accept_primary_output`

Accepts the reviewed current DOCX and unlocks PPTX, PDF, and Canva. Acceptance binds the source revision and DOCX checksum.

## `rework_primary_output`

Accepts validated replacement content, advances the source revision, makes old outputs stale, and creates a refreshed HTML design preview. A project permits at most two reworks. The refreshed design must be reviewed before DOCX is regenerated; rework never silently publishes against the previously approved layout.

## `replace_creature_content`

Replaces one selected creature without consuming authoring iterations or primary-output rework allowance. By default it applies the age-derived poem contract. For an incremental correction only, `humanApprovedRhymeScheme` is an explicit human attestation and may be `ABA`, `ABAB`, or `AABB`; it must exactly match `creature.poem.rhymeScheme` and differ from the age default. `ABA` requires three lines per stanza; `ABAB` and `AABB` require four. The project persists only the attested creature-to-scheme map, then supplies that full map to every subsequent complete-book validation. A new or changed alternative requires the explicit input; an unchanged, already-attested scheme can be retained for a text-only correction, and reverting to the default removes its map entry. A legacy or malformed project with an alternative but no stored attestation does not infer approval. Age-derived stanza count and word guidance, all language, Kannada-script, encoding, and DOCX/PPTX overflow checks still apply. Unsupported, absent/mismatched, or default-equivalent override input is rejected before project persistence.

## `replace_closing_note`

Accepts only a non-empty book-level `closingNote` string, trimmed and limited to 240 characters. It cannot carry or alter any other content field. A successful correction increments both the project revision and source revision once, preserves authoring-iteration and primary-output-rework allowances, makes the prior design and exports stale, clears the design preview and primary-output readiness, and requires a fresh design review before export. Invalid, oversized, wrong-script, or mojibake input is rejected without changing project bytes. A closing-note-only DOCX overflow is unreachable under this schema: exceeding the 120-word closing-note budget requires at least 241 characters, so the stricter character limit rejects that input first.

A blocking content-validation error prevents document generation.

The DOCX logical page count is:

```text
1 cover + (3 × approved creatures) + 1 when closingNote is non-empty
```

The three creature pages are always poem, fun fact, and activity in that order. Each begins at an explicit page boundary, embeds the same approved creature artwork with proportional fitting and non-visible alternative text, and uses typography selected from `effectiveAgeBand`. The cover embeds the separately approved cover asset. DOCX-specific overflow-risk errors are blocking; content is never truncated or silently shrunk.

DOCX fun-fact and activity budgets are 70 words for ages 3–5, 100 for 6–8, 140 for 9–11, and 180 for 12–14. Illustration briefs are limited to 60 words, accessible descriptions to 40 words, and closing notes to 120 words. These conservative preflight limits control overflow risk across compatible local renderers; a reference render remains the release gate when LibreOffice is available.

DOCX generation uses only local libraries. LibreOffice and Poppler are optional reference-rendering dependencies and are not required to create an editable DOCX.

Optional-format failures preserve successful artifacts and produce a `partially_complete` project with structured `exportFailures`; mandatory DOCX failure remains blocking. PDF follows the deterministic local specification in [MVP PDF generation](pdf-generation.md).

PPTX uses the canonical cover, poem, fun-fact, activity, and optional closing-page sequence. It preserves editable book text and stores image alternative text in DrawingML. Kannada PPTX records a warning because `Noto Sans Kannada` is referenced but not embedded.

## `check_canva_readiness`

Records host-reported `ready`, `unavailable`, or `authorization_required` state plus optional adapter metadata. It sends no book content. Unavailable and unauthorized states return distinct recovery guidance.

## `confirm_canva_handoff`

Persists explicit approval or decline for the current approved source revision, design revision, and illustration-set digest. A Canva template selection is not required for faithful reproduction.

## `select_canva_design`

Optional. Records a Canva design/template choice and changes the handoff mode to `explicit_redesign_requested`. The normal mode is faithful canonical reproduction without template selection.

## `prepare_canva_handoff`

Returns the approved `BookDesign` page plan in a versioned, adapter-neutral `create_editable_design` envelope with project/revision correlation, theme, format profile, exact approved assets, source revision, design revision, and illustration digest. Default mode is `faithful_canonical_reproduction`. It does not call Canva itself. Adapters must report unavoidable exceptions and fail explicitly if editable Kannada cannot be preserved.

## `record_canva_result`

Accepts a discriminated `success` or `failed` result. Failures persist a code, safe message, retryability, and timestamp. Success requires a genuine matching HTTPS Canva design URL and parity metadata matching the approved source revision, design revision, illustration-set digest, and page count.

## `get_delivery_summary`

Returns creatures covered, page count, review status, rework usage, accepted primary output, current local artifacts, stale artifacts, Canva state, `localDeliveryComplete`, and valid `nextActions`. The final delivery contains only formats genuinely created for the current source revision.

Review state is independent from workflow stage:

- `review.language.status` is `required` for experimental Kannada output and
  `not_required` for English output.
- `review.content.status` is `not_available` before content generation,
  `required` while validation warnings remain, and `complete` otherwise.
- `review.content.outstandingCount` and `review.content.issues` expose
  unresolved factual/content warnings.

The legacy `languageReviewRequired` boolean remains available for compatibility.
