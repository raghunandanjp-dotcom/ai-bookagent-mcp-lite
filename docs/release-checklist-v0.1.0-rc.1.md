# v0.1.0-rc.1 release checklist

This checklist separates repository-local evidence from human, connector, publication, and maintainer-controlled gates. A blocked or pending item is never a pass.

## Candidate identity

- Proposed tag: `v0.1.0-rc.1`
- Merged starting baseline: `5b4a293010b1db52f9997095c77118b3c5a81930` (ENH-0009 merged to `main`)
- Candidate commit: pending completion and merge of this RC-readiness change
- npm status: not asserted as published; verify the registry immediately before any npm install or publish statement
- GitHub release status: not created

## Local and automated gates

- [x] Clean `npm ci --no-audit --no-fund` in the isolated worktree (2026-08-10)
- [x] Final `npm run check` in the RC-readiness worktree: build, entrypoints, 92/92 tests, and portability passed (2026-08-10). Re-run on the eventual candidate commit after merge.
- [x] `npm run test:smoke` (2026-08-10)
- [x] DOCX 1/5/11/20 artifact generation; 4/16/34/61 logical pages expected because this fixture has no closing note
- [x] PPTX 1/5/11/20 artifact generation; 5/17/35/62 slides expected with the fixture closing note
- [x] PDF 1/5/11/20 artifact generation; 5/17/35/62 pages expected with the fixture closing note
- [x] PDF Poppler rendering and visual inspection: exactly 5/17/35/62 pages; all 119 pages scanned by contact sheet and representative pages reviewed full-size
- [ ] DOCX LibreOffice/Poppler rendering and visual inspection — blocked locally because LibreOffice is unavailable
- [ ] PPTX LibreOffice/Poppler rendering and visual inspection — blocked locally because LibreOffice is unavailable
- [x] All local Markdown link targets resolve; executable README flow is covered by the passing full gate
- [x] Clean `git diff --check` and intended-file review

## Human and external gates

- [ ] Current-baseline five-creature English Claude run completes content review, illustration import, HTML design approval, DOCX acceptance, and requested secondary exports. The visible historical `.claude-tests/cld-eng-04` manifest stops at `content_review_required`; do not commit that generated project.
- [ ] English factual, safety, editorial, layout, and accessibility review recorded
- [ ] One-creature Kannada run passes automation plus fluent human language and rendered-glyph review
- [ ] One consented Canva run returns a genuine matching HTTPS edit URL and passes parity/visual review
- [ ] Release decision records reviewer names, artifact locations, candidate commit, and disposition of every open finding

## Maintainer-controlled publication steps

Do these only after explicit approval and after every required gate above is either passed or accepted as a documented release limitation.

1. Merge the approved RC-readiness PR into `main`, fetch, and verify that local `main` exactly matches the intended GitHub commit.
2. In **GitHub → Settings → General → Danger Zone → Change repository visibility**, choose **Public**, type the repository name when prompted, and confirm. Re-check that no secrets, local projects, logs, generated exports, or private issue data are present before confirming.
3. In **GitHub → Settings → Collaborators and teams → Add people**, invite the named release reviewer with the least repository role that permits the requested review. Record the invitee and role in the release evidence.
4. From the verified `main` commit, create the annotated tag locally: `git tag -a v0.1.0-rc.1 -m "AI Book Agent MCP Lite v0.1.0-rc.1"`.
5. Push only that tag after approval: `git push origin v0.1.0-rc.1`.
6. In **GitHub → Releases → Draft a new release**, select `v0.1.0-rc.1`, target the verified `main` commit, title it `AI Book Agent MCP Lite v0.1.0-rc.1`, paste the reviewed changelog summary and known gates, and mark it as a **pre-release**.
7. Attach only approved distributable artifacts and checksums. Do not attach generated book projects, Claude logs/prompts, credentials, or human-review working files.
8. Publish the GitHub pre-release, verify its tag/commit/assets/links from a signed-out browser, and then update the changelog date/link in a follow-up change.
9. If npm publication is separately approved, authenticate with the intended npm account, verify package contents with `npm pack --dry-run`, verify the name/version are available, and publish the approved tarball with an RC dist-tag (for example, `npm publish --tag rc`). Confirm the registry page before changing README wording to say it is published.

Visibility, invitations, tag pushes, GitHub releases, and npm publication are deliberately outside this documentation change.
