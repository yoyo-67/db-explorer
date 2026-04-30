# Drop /explorer/documents, fold FK children into row detail

The Documents route originally listed root tables (those referenced by ≥1 FK) with their first 10 rows and inline children. Once row detail becomes its own route (ADR-0001) and renders incoming-FK children inline by definition, the Documents page is the same feature with strictly worse ergonomics: 10-row hard cap, no filter on roots, no paging, can't link to a single document.

Deleting it removes a duplicate concept (the word "Document" was already mis-implying Mongo-style JSON blobs) and keeps a single answer to "where do I look at a row and its children": the row detail route. `getDocumentCollections` and `DocumentView` go with it.

## Considered options

- **Keep it as a curated overview** — rejected: nothing distinguishes it from the table list with a "has children" filter, which the sidebar can offer for free if needed.
- **Merge as `/t/$table?as=document` toggle** — rejected: doubles the rendering paths for negligible UX gain.
