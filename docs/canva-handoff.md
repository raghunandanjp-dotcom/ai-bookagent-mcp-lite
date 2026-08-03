# Canva handoff

Canva is an optional second phase. The project does not install connectors, perform authorization, or presume a specific Claude connector tool name.

## Checkpoint

1. Generate and review the DOCX primary output.
2. Explicitly accept that DOCX for the current source revision.
3. Optionally create PPTX and/or PDF.
4. Ask the host to report Canva as `ready`, `unavailable`, or `authorization_required`.
5. If unavailable or unauthorized, show the corresponding setup instructions and pause.
6. Present host-provided design choices and record the user's selection.
7. Ask for explicit consent for that design and source revision.
8. Create a neutral handoff payload.
9. Let the host invoke the connector exposed by its environment.
10. Record either a structured connector failure or the returned design ID and genuine Canva edit URL.

Connector tool names and arguments may change. Host integrations should map the neutral handoff payload to the currently available connector contract.

No content leaves the local project during readiness checks.

## State and resume model

```text
not_checked -> setup_required | design_selection_required
design_selection_required -> ready_for_consent
ready_for_consent -> declined | consented
consented -> failed | complete
failed -> failed | complete
```

A declined handoff remains a completed local delivery and can be restarted with a new readiness check. A retryable failure retains consent for the selected design and source revision, so the neutral payload can be prepared again. A readiness recheck, design change, content change, or DOCX rework invalidates prior consent.

## Neutral connector boundary

`prepare_canva_handoff` returns versioned data with `operation: "create_editable_design"`, project/revision correlation, the selected design, and the reviewed pages. It never calls Canva. A host-specific adapter maps this payload to the currently exposed connector tool and returns one of:

```json
{ "outcome": "success", "designId": "DAG...", "editUrl": "https://www.canva.com/design/DAG.../edit" }
```

```json
{ "outcome": "failed", "code": "timeout", "message": "Connector timed out", "retryable": true }
```

Success URLs must use HTTPS on a Canva-owned hostname, contain no credentials, use a Canva `/design/{id}` edit path, and contain the same design ID as the result. This is structural validation; actual existence and account access can only be established by the authorized connector or by opening the URL.

Changing canonical content or reworking DOCX invalidates the design selection and consent. Canva is never treated as the source of truth for book text. Connector limitations may prevent listing or updating designs; the host must disclose those limitations and provide the design identifier and title selected by the user.
