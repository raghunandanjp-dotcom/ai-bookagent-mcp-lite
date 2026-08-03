# MCP tool contracts

## `create_book_project`

Creates the manifest from a theme, title, age band, language, creature count, brief, and requested export formats. DOCX is inserted even when omitted.

## `set_creature_selection`

Sets the initial list or consumes one of two full-list regenerations. `excludePrevious` applies the cumulative no-reuse ledger. Alias collisions are rejected.

## `approve_creature_selection`

Locks a non-empty reviewed selection.

## `prepare_authoring_prompt`

Produces host-assisted prompt batches. More than ten creatures are split into groups of five.

## `reiterate_authoring_prompt`

Produces at most two further prompt packages without another user choice. Iteration one uses the selected age; iteration two uses the next age band, capped at 12–14. This counter is independent from creature-list regeneration.

## `validate_book_content`

Validates schema, approved-creature coverage, duplicates, unexpected creatures, poem title/age/stanza/line/rhyme declarations, adjacent stanza repetition, requested and section language, age-band DOCX and PPTX overflow limits, projected pages, total words, and review flags. Presentation overflow is blocking rather than silently shrunk or paginated.

## `create_document_exports`

DOCX is always generated first and is mandatory even when callers request only optional formats. A blocking content-validation error prevents document generation.

The DOCX logical page count is:

```text
1 cover + (3 × approved creatures) + 1 when closingNote is non-empty
```

The three creature pages are always poem, fun fact, and activity in that order. Each begins at an explicit page boundary, includes a deterministic illustration placeholder with both the illustration brief and accessible description, and uses typography selected from `effectiveAgeBand`. DOCX-specific overflow-risk errors are blocking; content is never truncated or silently shrunk.

DOCX fun-fact and activity budgets are 70 words for ages 3–5, 100 for 6–8, 140 for 9–11, and 180 for 12–14. Illustration briefs are limited to 60 words, accessible descriptions to 40 words, and closing notes to 120 words. These conservative preflight limits control overflow risk across compatible local renderers; a reference render remains the release gate when LibreOffice is available.

DOCX generation uses only local libraries. LibreOffice and Poppler are optional reference-rendering dependencies and are not required to create an editable DOCX.

Optional-format failures preserve successful artifacts and produce a `partially_complete` project with structured `exportFailures`; mandatory DOCX failure remains blocking. PDF follows the deterministic local specification in [MVP PDF generation](pdf-generation.md).

PPTX uses a deterministic cover plus poem, fun-fact, and activity slide per creature. It preserves editable text and placeholders. Kannada PPTX records a warning because `Noto Sans Kannada` is referenced but not embedded.

## `check_canva_readiness`

Records host-reported connector availability. When unavailable, returns guided installation and authorization steps.

## `confirm_canva_handoff`

Records explicit user consent. No handoff is available without consent.

## `prepare_canva_handoff`

Returns the reviewed page plan and connector-ready content. It does not call Canva itself.

## `record_canva_result`

Records a real design ID and validates that the edit URL belongs to Canva.

## `get_delivery_summary`

Returns creatures covered, page count, review status, local artifacts, and Canva state.

Review state is independent from workflow stage:

- `review.language.status` is `required` for experimental Kannada output and
  `not_required` for English output.
- `review.content.status` is `not_available` before content generation,
  `required` while validation warnings remain, and `complete` otherwise.
- `review.content.outstandingCount` and `review.content.issues` expose
  unresolved factual/content warnings.

The legacy `languageReviewRequired` boolean remains available for compatibility.
