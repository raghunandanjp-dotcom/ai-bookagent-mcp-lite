# Canva handoff

Canva is an optional second phase. The project does not install connectors, perform authorization, or presume a specific Claude connector tool name.

## Checkpoint

1. Generate DOCX and any selected PPTX/PDF files.
2. Ask the host whether Canva is installed and authorized.
3. If unavailable, show setup instructions and pause.
4. If available, ask the user for explicit consent.
5. Create a neutral handoff payload.
6. Let Claude invoke the connector exposed by its environment.
7. Record the returned design ID and genuine Canva edit URL.

Connector tool names and arguments may change. Host integrations should map the neutral handoff payload to the currently available connector contract.

No content leaves the local project during readiness checks.
