# Canva handoff

Canva is an optional second phase. The project does not install connectors, perform authorization, or presume a specific Claude connector tool name.

## Checkpoint

1. Generate and review the DOCX primary output.
2. Explicitly accept that DOCX for the current source revision.
3. Optionally create PPTX and/or PDF.
4. Ask the host whether Canva is installed and authorized.
5. If unavailable, show setup instructions and pause.
6. Present host-provided design choices and record the user's selection.
7. Ask for explicit consent for that design and source revision.
8. Create a neutral handoff payload.
9. Let the host invoke the connector exposed by its environment.
10. Record the returned design ID and genuine Canva edit URL.

Connector tool names and arguments may change. Host integrations should map the neutral handoff payload to the currently available connector contract.

No content leaves the local project during readiness checks.

Changing canonical content or reworking DOCX invalidates the design selection and consent. Canva is never treated as the source of truth for book text. Connector limitations may prevent listing or updating designs; the host must disclose those limitations and provide the design identifier and title selected by the user.
