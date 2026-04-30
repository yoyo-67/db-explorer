# Sidebar + per-table route with URL as source of truth

The app shifts from a single stacked-cards page to a sidebar (Groups → Tables tree) plus per-table route `/t/$schema/$table` and per-row route `/t/$schema/$table/row/$id`. Filter, sort, page, and selected schema live in the query string. Row detail is its own route, never a modal or drawer.

This is the only navigation shape that supports honest FK traversal: clicking an FK cell renders a real `<Link>` to the parent row, so the browser back button retraces a chain of relations. Modals or master-detail-in-one-page would force us to reinvent history. URL-as-state also lets us deep-link a filtered, paged view of any table, which is the bulk of the value an app dev wants from this tool.

## Considered options

- **Master/detail in one page** — cheap, but no deep link and FK navigation collapses.
- **Per-card anchors with `?expand=name`** — minimum churn, maximum friction; doesn't compose with FK chains.
- **Modal/drawer for row detail** — chosen against because back-button semantics break and there's no room for incoming-FK children.
