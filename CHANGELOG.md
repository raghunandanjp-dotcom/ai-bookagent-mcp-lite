# Changelog

All notable changes are documented here. This project follows [Semantic Versioning](https://semver.org/); release dates and links are added only after the corresponding release exists.

## [0.1.0-rc.1] - Unreleased

Planned first public release candidate.

### Added

- Host-assisted English creature-poetry workflow for ages 3–14 and up to 20 creatures
- Experimental native Kannada workflow with explicit human language and glyph-review gates
- Strictly constrained Claude-authored SVG illustration sets, local rasterization, and checksum-bound reuse
- Canonical HTML-first `BookDesign` review shared by DOCX, PPTX, PDF, and Canva
- Editable DOCX/PPTX plus local PDF output with deterministic page plans and accessibility metadata
- Resumable revisions, content/design/DOCX approvals, bounded regenerations and reworks, and delivery summaries
- Consent-gated, adapter-neutral Canva readiness and handoff contracts
- Boundary-size structural and render QA harnesses for 1/5/11/20-creature outputs

### Security

- Absolute-path and project-containment enforcement for MCP filesystem access
- Untrusted-input validation for content, SVG, raster assets, connector results, and returned Canva URLs
- No built-in OAuth credential storage, paid model API call, or automatic cloud upload

### Known release gates

- DOCX and PPTX visual rendering awaits LibreOffice-backed RC evidence.
- English current-baseline Claude content/design/export review is pending; the visible `cld-eng-04` run stops at `content_review_required`.
- Kannada requires fluent human language and rendered-glyph approval.
- Canva requires one authorized, consented end-to-end run and matching edit-link review.
- npm publication, GitHub public visibility, tag, and GitHub release do not yet exist and require explicit maintainer approval.
