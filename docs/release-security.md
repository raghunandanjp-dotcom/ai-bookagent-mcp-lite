# Release dependency security

Last reviewed: 2026-08-10

Production dependency audits must be run with `npm audit --omit=dev`. Release changes should prefer compatible upgrades and must not accept npm's proposed major-version changes without checking the affected API and advisory reachability.

## Current decisions

- `fast-uri` advisory [GHSA-7p8r-x3mc-p8w7](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7) is remediated by resolving `fast-uri` 3.1.5 or newer within AJV's existing range.
- `hono` advisories [GHSA-8j4g-w8fx-2239](https://github.com/advisories/GHSA-8j4g-w8fx-2239), [GHSA-f23p-vx2j-j53r](https://github.com/advisories/GHSA-f23p-vx2j-j53r), [GHSA-79qm-7rj5-m7r9](https://github.com/advisories/GHSA-79qm-7rj5-m7r9), and [GHSA-54fx-42gc-7vw4](https://github.com/advisories/GHSA-54fx-42gc-7vw4) are remediated by resolving `hono` 4.12.34 or newer within the MCP SDK's existing range.
- `image-size` advisories [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) remain open through `pptxgenjs` 4.0.1. As of this review, `pptxgenjs` 4.0.1 is current and still depends on `image-size` 1.x; npm proposes downgrading to `pptxgenjs` 1.1.5, which is not a safe compatible fix.

## `image-size` reachability assessment

The reported infinite loops are in the ICNS, JXL, and HEIF parsers. Those formats are outside this application's illustration boundary:

1. Imports are read into memory with an application byte limit.
2. `inspectIllustration` accepts only PNG magic bytes or a parseable JPEG marker stream, and applies pixel-dimension limits.
3. Imported files are copied to a generated `.png` or `.jpg` path rather than retaining an attacker-controlled extension.
4. Before export, the application repeats byte-format and dimension inspection and verifies the recorded SHA-256 digest, byte count, MIME type, width, and height.
5. Only those resolved PNG/JPEG paths are passed to PptxGenJS.

Consequently, the affected ICNS/JXL/HEIF parser branches are not reachable through the supported import and PPTX-export workflow. The residual advisory is accepted for this release with the following conditions:

- do not expose PptxGenJS directly to unvalidated paths or buffers;
- keep the PNG/JPEG validation and revalidation boundary in place;
- monitor `pptxgenjs` and `image-size` for a compatible patched release; and
- rerun the production audit before every release.
