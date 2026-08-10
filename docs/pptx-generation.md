# MVP PowerPoint generation

PPTX export is offline, deterministic, and editable. PptxGenJS writes native Office text boxes and shapes; it does not rasterize book text or require a paid or cloud-only service.

## Sequence and slide count

The deck contains `1 + (3 × creature count)` slides when there is no closing note, plus one final slide when `closingNote` is non-empty. Slide 1 is the cover. Each creature then receives, in approved content order, one poem slide, one fun-fact slide, and one activity slide. The optional closing note uses the same canonical final page as the HTML, DOCX, and PDF outputs.

| Creatures | Without closing note | With closing note |
| ---: | ---: | ---: |
| 1 | 4 | 5 |
| 5 | 16 | 17 |
| 11 | 34 | 35 |
| 20 | 61 | 62 |

## Editable layout and accessibility

Slides use the 13.3 × 7.5 inch wide layout. The cover embeds the approved cover artwork. Content slides place editable creature and section text in the left column and proportionally fitted approved artwork in the right column. Every creature's poem, fun-fact, and activity slides reference the same approved source digest. Alternative text is stored in DrawingML and is not rendered as a label. Object creation follows reading order: creature title, section label, body, artwork, and slide number.

Text uses dark navy or ink on cream, and accent colors are never the only indication of section meaning. Generated decks include title, author, subject, creator, and language metadata. Future inserted images must carry supplied alternative text; audio, video, chart, table, hyperlink, Markdown, and HTML insertion are outside this MVP.

## Typography and density

| Age | Creature title | Section label | English body | Poem words/chars | Fact words/chars | Activity words/chars | Explicit lines |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3–5 | 30 pt | 24 pt | 28 pt | 40 / 260 | 25 / 180 | 30 / 220 | 8 |
| 6–8 | 28 pt | 24 pt | 24 pt | 60 / 400 | 40 / 280 | 50 / 340 | 10 |
| 9–11 | 26 pt | 24 pt | 21 pt | 90 / 600 | 60 / 420 | 75 / 520 | 12 |
| 12–14 | 24 pt | 24 pt | 18 pt | 120 / 800 | 80 / 560 | 100 / 700 | 14 |

Overflow is a blocking content-validation error. The exporter does not truncate, add continuation slides, or silently shrink text. Kannada uses a body size one point larger and 85% of the corresponding character ceiling.

## Fonts and language

English uses Arial and standard viewer substitution if Arial is unavailable. Experimental Kannada uses `Noto Sans Kannada` with `kn-IN` language metadata. The font is referenced but not embedded, so Kannada exports always carry a warning requiring that font on every viewing or editing system. The exporter does not install fonts or access the network.

Book language must match the requested language, and every poem, fact, and activity language must match the book language. Kannada content must contain Kannada-script text and remains subject to human language review.

## Verification

`npm run test:pptx` generates and structurally inspects representative decks. It verifies slide counts and order, editable OOXML text, metadata, embedded media, alternative text, per-creature digest reuse, fonts, absence of forbidden production copy, and absence of shrink-to-fit instructions.

`npm run qa:pptx:render` builds 1-, 5-, 11-, and 20-creature decks with closing notes under the ignored `.pptx-qa` directory and uses LibreOffice plus Poppler, when installed, to render them for visual review. Review the cover, closing slide, and first, middle, and last creature triplets at full size, then scan the complete contact set for clipping, distortion, overlap, unexpected wrapping, missing glyphs, asset substitution, forbidden labels, and slide-number discontinuities. Kannada should also be opened in Microsoft PowerPoint when available before production use.
