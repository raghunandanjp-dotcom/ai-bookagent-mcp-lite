# Contributing

Contributions are welcome. Keep the deterministic core usable without paid APIs.

Before opening a pull request:

```bash
pnpm install
pnpm check
```

Do not commit:

- Generated book projects or exports
- Credentials or connector tokens
- Machine-specific absolute paths
- Model-generated facts presented as reviewed
- Dependencies or workflows that require a paid service for tests

New features should preserve DOCX-first delivery and the explicit Canva consent boundary.
