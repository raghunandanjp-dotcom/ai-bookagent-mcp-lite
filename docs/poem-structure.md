# MVP poem structure

Age is the only poem-structure choice presented to the user. All other settings are deterministic defaults.

| Age | Stanzas | Lines per stanza | Rhyme | Word guidance |
| --- | ---: | ---: | --- | ---: |
| 3–5 | 2 | 2 | AA | 8–40 |
| 6–8 | 2 | 3 | AAB | 16–70 |
| 9–11 | 3 | 4 | AABB | 30–130 |
| 12–14 | 4 | 3 | AAB | 48–200 |

Every poem has a title. One newline separates lines and one blank line separates stanzas. A complete stanza may not repeat immediately. Structural violations are blocking; word-budget and automated rhyme-quality findings are advisory.

The initial generation and first iteration use the selected age. The second and final iteration uses the next age band. Ages 12–14 remain 12–14 for both iterations. Poem iterations are independent from creature-list regenerations.

An incremental `replace_creature_content` correction may carry an explicit human-approved alternative rhyme scheme. The smallest supported override set is `ABA` (three lines), `ABAB` (four), or `AABB` (four); the declaration must match the replacement poem, and it must differ from that age band's default. The override changes only the corrected poem's required lines per stanza. Its age-derived stanza count, word guidance, all overflow limits, language/script checks, and encoding checks remain unchanged. Initial generation, prompt iterations, full-content acceptance, and primary-output rework never receive this override and therefore retain the table defaults.

English is the standard behavior. Kannada remains experimental, requires human review, and must be written as a native adaptation rather than a literal translation.

DOCX, PPTX, PDF, and Canva consumers must preserve poem titles and intentional line and stanza breaks. Layout-specific decisions remain owned by their exporter workflows; Canva remains optional and consent-gated.
