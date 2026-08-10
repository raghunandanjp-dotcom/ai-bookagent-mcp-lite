# Experimental Kannada and Canva qualification

This procedure qualifies the experimental Kannada path and the optional Canva
handoff without treating automated checks as human or external evidence. It is
designed to be resumed: retain the evidence record after every completed step,
and leave incomplete steps as `pending` or `blocked`, never `passed`.

## Evidence classes

| Class | What it can establish | What it cannot establish |
| --- | --- | --- |
| Automated contract | Schema, state gates, script checks, package structure, declared fonts, payload correlation, and URL shape | Fluent Kannada, rendered glyph quality, connector availability, account access, or Canva visual fidelity |
| Local render | Font loading, glyph presence, wrapping, clipping, page order, and visible layout on the tested machine | Linguistic quality or behavior in Canva and other machines |
| External connector | Readiness/auth state, a real Canva operation, returned metadata, and access to the returned URL | Human language quality or visual parity unless those are separately reviewed |
| Human review | Native phrasing, age fit, factual/editorial acceptability, and visual fidelity | Repeatable enforcement by the software |

Record the baseline commit, commands, timestamps, runtime/tool versions, exact
artifact paths and SHA-256 digests, and reviewer identity or role. Do not commit
credentials, connector logs containing tokens, private edit URLs, or children's
personal data.

## Kannada acceptance (`KAN-ACC-001`)

Use one living creature, age 6-8, and an English source brief with language set
to `kn`. Use the final release-candidate commit and the normal public workflow.

1. Save the request, selected creature, generated content, validation report,
   approved illustration manifest, canonical design manifest, and exports in a
   dedicated project directory. Record their SHA-256 digests.
2. Confirm every reader-facing field is Kannada: book title, creature display
   name, poem title and text, fun fact, activity, and any closing note. English
   is permitted only in production metadata such as `illustrationBrief` and
   `altText`. Save the successful validation report.
3. In a disposable copy, insert a Latin word into one reader-facing field and
   resubmit it. Save the rejected report containing `mixed_script_content` at
   that exact field. Do not reuse the negative copy for positive evidence.
4. Set `BOOK_AGENT_KANNADA_FONT_PATH` to the reviewed Kannada-capable TTF. Build
   the HTML design preview and DOCX, PPTX, and PDF outputs requested for the
   release. Confirm the PDF glyph-coverage check passes. Record the font file's
   name, version if available, and SHA-256 digest. Remember that DOCX/PPTX font
   declarations alone are structural evidence, not glyph evidence.
5. Render the HTML preview and every generated format using the intended local
   viewers. Inspect every reader-facing string at normal size and zoomed in for
   tofu/missing glyphs, broken conjuncts or vowel marks, substitution,
   transliteration, clipping, overlap, and lost line or stanza breaks. Record
   viewer versions and attach screenshots or rendered pages by artifact digest.
   If LibreOffice/Poppler or the Kannada font is unavailable, mark this step
   `blocked`.
6. Give the same digest-bound artifacts to a fluent Kannada reviewer. The
   reviewer checks native—not line-by-line translated—language, meaning,
   grammar, cadence, age suitability, section labels, and the rendered glyph
   findings. Record reviewer name or accountable role, date, fluency basis,
   source revision, artifact digests, decision (`approved` or `changes_required`),
   and notes. A model assertion or repository author self-attestation does not
   substitute for this review.

`KAN-ACC-001` passes only when steps 1-6 pass on the same source revision and
artifact digests. Any content, illustration, design, font, or export change
invalidates the affected downstream evidence.

## Real Canva acceptance (`CAN-ACC-001`)

Use the already approved canonical design and accepted current DOCX. A template
must not be selected for the faithful-default case.

1. Record the project ID, project revision, source revision, design revision,
   illustration-set digest, page count, and canonical preview digest.
2. Run readiness without sending book content. Record the host/adapter identity,
   time, and reported state. If unavailable or authorization is required, follow
   the returned setup instructions and pause as `blocked`; do not call that a
   connector failure or success.
3. When readiness is `ready`, show the user the exact approved source revision,
   design revision, illustration digest, operation, and destination account.
   Persist explicit consent. A previous consent is invalid after any bound value
   changes.
4. Prepare and save the neutral handoff. Confirm mode is
   `faithful_canonical_reproduction`, `selectedDesign` is absent, every page is
   present in order, every required approved asset appears once with the expected
   digest, and the correlation/parity fields match step 1. Record the handoff
   digest.
5. Invoke the authorized Canva connector once and save a redacted receipt. On
   failure, record the structured code/message/retryability and resume according
   to the state model. On success, require matching source revision, design
   revision, illustration digest, page count, design ID, and an HTTPS Canva URL
   whose path is `/design/{designId}/edit`.
6. Open the returned URL while signed into the intended account. Confirm it
   resolves to the same design and permits editing; a reversible edit followed
   by undo is sufficient. URL-shape validation alone does not pass this step.
7. Compare every Canva page side by side with the approved canonical preview.
   Review page order/count, exact wording, poem line/stanza breaks, colors,
   typography intent, illustration identity/placement, editable text, clipping,
   and every reported format exception. Record reviewer, date, decision, and
   screenshot references. For Kannada, also apply `KAN-ACC-001` glyph and fluent
   language review requirements inside Canva.

`CAN-ACC-001` passes only when steps 1-7 pass for one correlation chain. A real
edit URL proves neither parity nor Kannada quality by itself.

## Evidence record

Store a resumable record outside source control when it contains private URLs or
account details. At minimum capture:

```json
{
  "testId": "KAN-ACC-001 or CAN-ACC-001",
  "baselineCommit": "<40 hex>",
  "status": "pending | blocked | passed | failed",
  "startedAt": "<ISO 8601>",
  "completedAt": "<ISO 8601 or null>",
  "bindings": {
    "projectId": "<id>",
    "sourceRevision": 1,
    "designRevision": 1,
    "illustrationSetDigest": "<64 hex>",
    "pageCount": 5
  },
  "artifacts": [{ "role": "content or preview or export", "path": "<path>", "sha256": "<64 hex>" }],
  "automated": [{ "command": "<command>", "result": "passed | failed | blocked", "evidence": "<path or note>" }],
  "external": [{ "check": "<readiness, operation, URL access, or parity>", "result": "passed | failed | blocked", "evidence": "<redacted path or note>" }],
  "humanReview": { "reviewer": "<name or accountable role>", "basis": "<fluency or review role>", "decision": "approved | changes_required", "notes": "<notes>" }
}
```

## Release scope

- A release candidate may include these paths as explicitly experimental and
  non-blocking while `KAN-ACC-001` and `CAN-ACC-001` are pending. Automated
  contract passes may be claimed; language, glyph, connector, edit-access, and
  visual-parity success may not.
- Stable support for Kannada must be blocked until `KAN-ACC-001` passes on the
  stable candidate. Stable support for Canva creation must be blocked until
  `CAN-ACC-001` passes on that candidate.
- The stable core release itself need not be blocked if the unqualified paths
  remain clearly excluded from stable support (experimental Kannada and optional
  unverified host-assisted Canva handoff). If either is advertised as validated
  stable behavior, its corresponding acceptance test is a release blocker.
