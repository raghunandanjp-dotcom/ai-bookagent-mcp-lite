# DOCX generation

DOCX is the mandatory primary output. It is generated only after structured content validates and the project contains exactly one approved cover illustration plus one approved illustration for every current creature.

## Page and asset model

The logical sequence remains one cover, three pages per creature (poem, fun fact, activity), and an optional closing page. The cover embeds the approved cover asset. Each creature's one approved image is reused on all three of that creature's pages; the exporter never generates, replaces, or substitutes artwork.

Book text remains searchable and editable. Illustration prompts, briefs, placeholder labels, generation messages, and internal alternative-text labels are never written as visible Word text. Each `ImageRun` stores the asset's reviewed alternative text in OOXML drawing properties.

## Layout and integrity

Images are fitted proportionally into bounded frames and are never stretched. Source bytes are embedded as PNG or JPEG. Before packaging, the workflow reopens every project-local asset and verifies its signature, MIME type, dimensions, byte count, SHA-256 digest, required slot, and approval status. Missing, corrupt, modified, unsupported, duplicated, unexpected, or unapproved assets block export with a slot-specific error.

Structural tests inspect media parts, relationships, drawing descriptions, digest reuse, and forbidden visible production copy. `npm run qa:docx:render` generates 1-, 5-, 11-, and 20-creature fixtures and renders them when LibreOffice and Poppler are available.
