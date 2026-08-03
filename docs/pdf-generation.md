# MVP PDF generation

PDF is an optional, local export. DOCX remains mandatory and is always attempted first. No paid API, cloud renderer, or machine-installed English font is required.

## Page model

The PDF uses A4 portrait pages with 56-point margins. It contains one cover followed by exactly three pages per creature: poem, fun fact, and activity. The deterministic page count is `1 + (3 × creature count)`, giving 4, 16, 34, and 61 pages for 1, 5, 11, and 20 creatures.

The optional content `closingNote` is not part of the MVP PDF and does not add a page. Poem titles and intentional line and stanza breaks are preserved exactly; the PDF exporter does not redefine poem structure or age iteration.

Section pages use a 24-point creature heading, 16-point section heading, 13-point body with 18-point leading, a running header, and a `Page X of Y` footer. Activity pages also carry the illustration brief and alt text as readable text.

## Fonts and failure behavior

English embeds the bundled OFL-licensed Noto Sans Regular and Bold fonts. Experimental Kannada requires `BOOK_AGENT_KANNADA_FONT_PATH` to name a readable Kannada-capable TTF font. A missing, invalid, or incomplete font fails PDF export clearly rather than producing broken glyphs.

Content is measured before it is placed. A section that cannot fit its fixed page fails with `pdf_text_overflow`; text is never clipped, silently shrunk, or allowed to create an extra page. PDFs larger than 25 MiB fail with `pdf_file_too_large`.

An optional PDF failure does not invalidate successful DOCX or PPTX files. Successful artifacts and structured failures are persisted, and the project becomes `partially_complete`. Failure of mandatory DOCX remains blocking.

## Accessibility and print expectations

The MVP produces searchable Unicode text in logical page order, embeds fonts, provides adequate contrast, includes page numbers, and renders illustration descriptions as text. It is accessibility-aware but is not certified as PDF/UA.

The file is suitable for A4 home, school, and office printing. It uses vector text and safe margins, but does not claim PDF/X conformance, CMYK output, bleed, crop marks, or commercial-press certification.

## Verification

Automated structural tests inspect page count, section coverage, extracted text, excluded closing notes, embedded font programs, missing-font behavior, and partial-export behavior. Representative 1, 5, 11, and 20-creature PDFs should also be rasterized locally and reviewed for clipping, broken glyphs, stanza preservation, footer collisions, and blank pages.
