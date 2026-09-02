# Canva handoff

Canva is an optional second phase. The project does not install connectors, perform authorization, or presume a specific Claude connector tool name.

## Checkpoint

1. Generate and review the DOCX primary output.
2. Explicitly accept that DOCX for the current source revision.
3. Optionally create PPTX and/or PDF.
4. Ask the host to report Canva as `ready`, `unavailable`, or `authorization_required`.
5. If unavailable or unauthorized, show the corresponding setup instructions and pause.
6. Ask for explicit consent for the approved source revision, design revision, and illustration digest.
7. Revalidate the complete approved illustration set and create a faithful neutral handoff payload.
8. Optionally record a Canva template only when the user explicitly requests redesign.
9. Convert the neutral payload to a validated local Canva import artifact.
10. Let the host pass that artifact through the connector's private `design_file` import route.
11. Record either a structured connector failure or the returned design ID and genuine Canva edit URL.

Connector tool names may change. The compatible Claude/Codex surface currently exposes an `import_design_from_url` capability whose `design_file` argument accepts a generated local HTML artifact. Despite the capability name, the adapter does not use its `url` argument.

No content leaves the local project during readiness checks.

## State and resume model

```text
not_checked -> setup_required | ready_for_consent
ready_for_consent -> declined | consented
consented -> failed | complete
failed -> failed | complete
```

A declined handoff remains a completed local delivery and can be restarted with a new readiness check. A retryable failure retains consent only while the canonical source/design/illustration bindings remain unchanged. A readiness recheck, design change, content change, or rework invalidates prior consent.

## Neutral connector boundary

`prepare_canva_handoff` returns versioned data with `operation: "create_editable_design"`, `mode: "faithful_canonical_reproduction"`, project/revision correlation, canonical design bindings, readiness and explicit-consent timestamps, the reviewed pages, and the same approved assets used by DOCX/PPTX/PDF. Every record carries approval evidence, a project-relative path, MIME type, dimensions, byte count, digest, alternative text, source, provenance, and license. Pages reference stable `illustrationAssetId` values. The adapter must upload those exact bytes and must not silently regenerate, replace, or substitute artwork. A host-specific adapter returns one of:

```json
{ "outcome": "success", "designId": "DAG...", "editUrl": "https://www.canva.com/design/DAG.../edit", "sourceRevision": 8, "designRevision": 2, "illustrationSetDigest": "<64 hex>", "pageCount": 17 }
```

```json
{ "outcome": "failed", "code": "timeout", "message": "Connector timed out", "retryable": true }
```

Success URLs must use HTTPS on a Canva-owned hostname and contain no credentials. Canonical `/design/{id}/edit` paths must contain the same design ID as the result. The private-file connector may return a `/d/{token}` short URL whose token does not encode that ID; only this exact Canva-owned short-link shape is accepted, retained as `connectorUrl`, and normalized to `/design/{designId}/edit` using the separately validated connector design ID. Arbitrary Canva paths and mismatched canonical paths remain rejected. The returned source/design/digest/page metadata must exactly match the approved `BookDesign`. URL existence and account access can only be established by the authorized connector or by opening it.

Changing canonical content, illustrations, or design invalidates consent. Canva is never the source of truth for book text. A template/design identifier is required only when the user explicitly opts into the redesign mode.

## Local file ingestion

`prepare_canva_import_artifact` is the faithful adapter for approved local projects. It accepts the neutral payload rather than inventing a second contract, compares that payload with the current persisted source/design revisions, illustration-set digest, page count, readiness, consent, and complete asset metadata, then re-reads and verifies every approved local image. Only an exact `faithful_canonical_reproduction` match produces output.

The output is a self-contained HTML presentation in the local project. Each top-level canonical page uses Canva's `data-document-role="page"` annotation; images are embedded from the verified bytes and the neutral metadata is retained inside the file. The returned `connectorRequest` maps directly to `import_design_from_url` with `design_file`, `intended_design_type: "presentation"`, the approved title, and a fidelity-only intent. The host passes the local file reference through that route. It must not use the URL argument, host the artifact publicly, invoke AI design generation, select a template, or reconstruct the design from prompts.

Adapter failures are structured as `{ "outcome": "failed", "code": "...", "message": "...", "retryable": true | false }`. Missing authorization or temporarily inaccessible local files may be retried after correction. Invalid/stale payloads, altered approved bytes, redesign requests, and canonical parity failures are non-retryable until a new readiness and consent cycle produces a new handoff.

## Host setup and limitations

The host must have an authorized Canva connector and must support conversion of a tool-produced absolute local artifact path into the connector's private file reference. Record that capability with `check_canva_readiness`, including the connector and tool names when known, before requesting consent. Codex's inspected connector surface supports this through `import_design_from_url.design_file`. A Claude or other host exposing only the public `url` argument is not compatible with this adapter; return a structured `private_file_input_unsupported` failure and do not upload the project elsewhere as a workaround.

The local adapter prepares and validates the request but does not perform Canva authorization, invoke the external connector, or prove the resulting design's visual fidelity. After an authorized import, the host must map the returned design ID/edit URL and the unchanged source revision, design revision, illustration digest, and page count into `record_canva_result`. `CAN-ACC-001` remains required for real connector, edit-access, page-parity, font, wrapping, and visual qualification. Kannada additionally remains subject to the language and glyph reviews below.

## Kannada transition

The user may supply the original brief in English. Kannada begins only when `language: "kn"` is selected, and only validated reader-facing Kannada is handed to Canva. The neutral payload then includes:

- locale `kn-IN`;
- Kannada section titles;
- preferred font `Noto Sans Kannada`;
- a requirement for complete Kannada glyph coverage and editable text;
- a prohibition on transliteration, text replacement, and rasterization;
- experimental-language and rendered-glyph review requirements.

Canva font availability is an adapter/runtime capability, not something the local project can prove during readiness checks. The host adapter must select an editable Kannada-capable font or return a structured non-retryable failure. Successfully recording the genuine edit URL means the design was created; it does not mean Kannada linguistic or rendered QA has passed. The user receives the link to continue editing, with fluent language review and in-Canva glyph, wrapping, and clipping review still required before publication.
