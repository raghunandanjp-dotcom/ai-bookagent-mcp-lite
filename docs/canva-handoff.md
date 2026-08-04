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
9. Let the host invoke the connector exposed by its environment.
10. Record either a structured connector failure or the returned design ID and genuine Canva edit URL.

Connector tool names and arguments may change. Host integrations should map the neutral handoff payload to the currently available connector contract.

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

`prepare_canva_handoff` returns versioned data with `operation: "create_editable_design"`, `mode: "faithful_canonical_reproduction"`, project/revision correlation, canonical design bindings, the reviewed pages, and the same approved assets used by DOCX/PPTX/PDF. Every record carries a project-relative path, MIME type, dimensions, byte count, digest, alternative text, source, provenance, and license. Pages reference stable `illustrationAssetId` values. The adapter must upload those exact bytes and must not silently regenerate, replace, or substitute artwork. A host-specific adapter returns one of:

```json
{ "outcome": "success", "designId": "DAG...", "editUrl": "https://www.canva.com/design/DAG.../edit", "sourceRevision": 8, "designRevision": 2, "illustrationSetDigest": "<64 hex>", "pageCount": 17 }
```

```json
{ "outcome": "failed", "code": "timeout", "message": "Connector timed out", "retryable": true }
```

Success URLs must use HTTPS on a Canva-owned hostname, contain no credentials, use a Canva `/design/{id}` edit path, and contain the same design ID as the result. The returned source/design/digest/page metadata must exactly match the approved `BookDesign`. URL existence and account access can only be established by the authorized connector or by opening it.

Changing canonical content, illustrations, or design invalidates consent. Canva is never the source of truth for book text. A template/design identifier is required only when the user explicitly opts into the redesign mode.

## Kannada transition

The user may supply the original brief in English. Kannada begins only when `language: "kn"` is selected, and only validated reader-facing Kannada is handed to Canva. The neutral payload then includes:

- locale `kn-IN`;
- Kannada section titles;
- preferred font `Noto Sans Kannada`;
- a requirement for complete Kannada glyph coverage and editable text;
- a prohibition on transliteration, text replacement, and rasterization;
- experimental-language and rendered-glyph review requirements.

Canva font availability is an adapter/runtime capability, not something the local project can prove during readiness checks. The host adapter must select an editable Kannada-capable font or return a structured non-retryable failure. Successfully recording the genuine edit URL means the design was created; it does not mean Kannada linguistic or rendered QA has passed. The user receives the link to continue editing, with fluent language review and in-Canva glyph, wrapping, and clipping review still required before publication.
