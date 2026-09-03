# Canonical BookDesign decision (ENH-0009)

## Why the workflow changed

ENH-0008 assumed that the host running Claude could generate six raster images and expose trustworthy absolute PNG/JPEG paths. The CLD-ENG-003 release-candidate exercise disproved that assumption: Claude produced the prompts, but the session had no image-generation connector and had to stop. Requiring the user to source, license, save, and map every image made the happy path dependent on capabilities outside this MCP.

An earlier prototype, `feathery_friends.html`, succeeded without that dependency because its visual layer was authored directly in HTML/CSS with Unicode decoration. It showed that code-native visuals can keep the workflow self-contained, but Unicode glyphs are not reliable enough for consistent print and presentation output.

ENH-0009 therefore adopts a code-native, HTML-first design workflow. Claude authors a complete illustration set using a constrained SVG subset. The MCP rejects scripts, event handlers, text, embedded data, links, external resources, and unsupported elements or attributes, then rasterizes accepted SVG locally to checksum-bound PNG. Existing PNG/JPEG imports remain available.

## Source of truth

`BookDesign` is the canonical design contract. It binds the validated content `sourceRevision`, a monotonic `designRevision`, the SHA-256 digest of the exact illustration set, page order and content, theme, typography intent, format profiles, and declared format exceptions.

The generated HTML preview is the human review artifact. One explicit design approval approves the page plan and complete illustration set shown in that preview. DOCX, PPTX, PDF, and optional direct Canva Connect import are permitted only from the approved, current `BookDesign`.

## Format contract

Outputs promise semantic parity, not pixel identity. They preserve approved page order, wording, poem breaks, illustrations, colors, typography intent, and accessibility text. A4 documents and 16:9 presentations necessarily use different geometry; unavoidable substitutions must be declared rather than silently redesigning the book.

Advanced local Canva Connect imports the code-generated canonical PPTX directly. It does not select templates or run redesign prompts.

## Reliability and provenance

Code-native illustration reliability comes from locally controlled inputs and reproducible transformation:

1. Exact required slots are validated as one batch.
2. SVG uses a strict allowlist and no remote dependencies.
3. SVG source and local PNG output are retained in the project.
4. Source and raster bytes receive SHA-256 provenance.
5. PNG signatures, dimensions, byte counts, and digests are rechecked before export.
6. Canva results must echo source revision, design revision, illustration-set digest, and page count.

This removes the unnecessary user-managed image-path constraint while retaining the option to import independently sourced artwork.
