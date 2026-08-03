# MCP tool contracts

## `create_book_project`

Creates the manifest from a theme, title, age band, language, creature count, brief, and requested export formats. DOCX is inserted even when omitted.

## `set_creature_selection`

Sets the initial list or consumes one of two full-list regenerations. `excludePrevious` applies the cumulative no-reuse ledger. Alias collisions are rejected.

## `approve_creature_selection`

Locks a non-empty reviewed selection.

## `prepare_authoring_prompt`

Produces host-assisted prompt batches. More than ten creatures are split into groups of five.

## `validate_book_content`

Validates schema, approved-creature coverage, duplicates, unexpected creatures, language script, section limits, projected pages, total words, and review flags.

## `create_document_exports`

Creates DOCX by default. PPTX and PDF require an accepted DOCX for the current source revision and may be created independently. All file locations remain inside the book-project directory.

## `accept_primary_output`

Accepts the reviewed current DOCX and unlocks PPTX, PDF, and Canva. Acceptance binds the source revision and DOCX checksum.

## `rework_primary_output`

Accepts validated replacement content and regenerates DOCX. A project permits at most two reworks. It returns the remaining count and the required warning.

## `check_canva_readiness`

Records host-reported connector availability. When unavailable, returns guided installation and authorization steps.

## `confirm_canva_handoff`

Records explicit user consent after a design is selected. No handoff is available without consent for the current source revision.

## `select_canva_design`

Records the user's design ID, title, optional template URL, and current source revision. Changing the selection requires fresh consent.

## `prepare_canva_handoff`

Returns the reviewed page plan and connector-ready content. It does not call Canva itself.

## `record_canva_result`

Records a real design ID and validates that the edit URL belongs to Canva.

## `get_delivery_summary`

Returns creatures covered, page count, review status, rework usage, accepted primary output, current local artifacts, stale artifacts, Canva state, and valid `nextActions`. The final delivery contains only formats genuinely created for the current source revision.

Review state is independent from workflow stage:

- `review.language.status` is `required` for experimental Kannada output and
  `not_required` for English output.
- `review.content.status` is `not_available` before content generation,
  `required` while validation warnings remain, and `complete` otherwise.
- `review.content.outstandingCount` and `review.content.issues` expose
  unresolved factual/content warnings.

The legacy `languageReviewRequired` boolean remains available for compatibility.
