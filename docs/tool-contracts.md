# MCP tool contracts

## `create_book_project`

Creates the manifest from a theme, title, age band, language, creature count, brief, and requested export formats. Interactive creation requires explicit age and language choices after the initial natural-language prompt. Kannada is presented as experimental and requiring fluent human review and discretion; the user's prompt may remain in English. DOCX is inserted even when omitted.

## `set_creature_selection`

Sets the initial list or consumes one of two full-list regenerations. `excludePrevious` applies the cumulative no-reuse ledger. Alias collisions are rejected.

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

## `review_illustration_asset`

Approves or rejects one imported asset and records the reviewer, time, and optional note. Re-importing a slot replaces its manifest record and returns it to pending review. Exactly one approved cover and one approved asset per current creature are required for export.

## `create_document_exports`

Creates DOCX by default. Before writing anything, it revalidates the complete approved illustration set from disk, including file signature, MIME type, dimensions, byte count, digest, required slots, unexpected slots, approval state, and the 80 MiB set limit. The primary DOCX is mandatory and must be accepted before PPTX or PDF can be created independently for the same source revision. All file locations remain inside the book-project directory. The underlying batch exporter still guarantees DOCX-first generation by default; the workflow disables that implicit regeneration only after the checksum-bound primary DOCX has already been accepted.

## `accept_primary_output`

Accepts the reviewed current DOCX and unlocks PPTX, PDF, and Canva. Acceptance binds the source revision and DOCX checksum.

## `rework_primary_output`

Accepts validated replacement content and regenerates DOCX. A project permits at most two reworks. It returns the remaining count and the required warning.

A blocking content-validation error prevents document generation.

The DOCX logical page count is:

```text
1 cover + (3 × approved creatures) + 1 when closingNote is non-empty
```

The three creature pages are always poem, fun fact, and activity in that order. Each begins at an explicit page boundary, embeds the same approved creature artwork with proportional fitting and non-visible alternative text, and uses typography selected from `effectiveAgeBand`. The cover embeds the separately approved cover asset. DOCX-specific overflow-risk errors are blocking; content is never truncated or silently shrunk.

DOCX fun-fact and activity budgets are 70 words for ages 3–5, 100 for 6–8, 140 for 9–11, and 180 for 12–14. Illustration briefs are limited to 60 words, accessible descriptions to 40 words, and closing notes to 120 words. These conservative preflight limits control overflow risk across compatible local renderers; a reference render remains the release gate when LibreOffice is available.

DOCX generation uses only local libraries. LibreOffice and Poppler are optional reference-rendering dependencies and are not required to create an editable DOCX.

Optional-format failures preserve successful artifacts and produce a `partially_complete` project with structured `exportFailures`; mandatory DOCX failure remains blocking. PDF follows the deterministic local specification in [MVP PDF generation](pdf-generation.md).

PPTX uses a deterministic illustrated cover plus poem, fun-fact, and activity slide per creature. It preserves editable book text and stores image alternative text in DrawingML. Kannada PPTX records a warning because `Noto Sans Kannada` is referenced but not embedded.

## `check_canva_readiness`

Records host-reported `ready`, `unavailable`, or `authorization_required` state plus optional adapter metadata. It sends no book content. Unavailable and unauthorized states return distinct recovery guidance.

## `confirm_canva_handoff`

Persists explicit approval or decline after a design is selected. No handoff is available without approval for the current source revision. Decline is a terminal local-first delivery outcome and may later be restarted through readiness.

## `select_canva_design`

Records the user's design ID, title, optional template URL, and current source revision. Changing the selection requires fresh consent.

## `prepare_canva_handoff`

Returns the reviewed page plan in a versioned, adapter-neutral `create_editable_design` envelope with project/revision correlation. It does not call Canva itself. Kannada payloads include `kn-IN`, localized section titles, editable-font and glyph-coverage requirements, and explicit human language/rendered review flags. Adapters must fail explicitly if they cannot preserve editable Kannada text. Retryable connector failures may resume with the same consent while the selected design and source revision remain unchanged.

## `record_canva_result`

Accepts a discriminated `success` or `failed` result. Failures persist a code, safe message, retryability, and timestamp. Success requires an HTTPS Canva design URL whose path ID exactly matches `designId`; lookalike domains, credentials, arbitrary paths, and mismatches are rejected.

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
