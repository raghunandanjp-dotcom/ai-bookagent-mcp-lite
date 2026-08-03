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

Validates schema, approved-creature coverage, duplicates, unexpected creatures, poem title/age/stanza/line/rhyme declarations, adjacent stanza repetition, language script, section limits, projected pages, total words, and review flags.

## `create_document_exports`

Always creates DOCX. It may also create PPTX and PDF. All file locations remain inside the book-project directory.

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
