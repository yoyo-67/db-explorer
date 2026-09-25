# JSON as a tree, and filtering by what's inside it

**Status:** design, approved in brainstorming. Spec pending review.
**Date:** 2026-09-25

## The problem

A JSON value is shown as a `<pre>` today, pretty-printed by `formatJsonText`
if the toggle is on. That's fine for reading a small document. It doesn't
help with the two things people do next:

- **Name a piece of it.** Writing `payload #>> '{steps,3,status}'` by hand
  means counting array positions in a `<pre>` and getting the quoting right.
- **Find rows where that piece has this value.** The filter panel offers json
  columns `isNull`, `notNull`, `regex` and `contains`, all against the value as
  text. "Rows whose `status` is `failed`" can only be written as a regex over
  the whole document. That's wrong on a key that appears twice, and it always
  reads every row.

Three places hold JSON and should read the same:

| Source | How it arrives | Filterable in SQL |
|---|---|---|
| `jsonb` / `json` column | parsed object from the driver | yes |
| `text` column holding a JSON document | string, recognised by `parseJsonText` | no. A cast errors on the first malformed row. |
| compressed `bytea` | `DecodedBlob { encoding: 'json', text }` | no. Postgres cannot decompress brotli. |

So all three get the tree and path copy. **Only `jsonb`/`json` get filtering.**
Those are the only ones where the filter can be real SQL that counts and
paginates honestly.

## Part A — the tree

### Pure logic: `src/lib/json-path.ts`

Browser-safe, no React.

```ts
type JsonPathPart = string | number          // key, or array index

type JsonLeafKind = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'

function leafKind(value: JsonValue): JsonLeafKind

/** `col #>> '{steps,3,status}'` — the form that always works. */
function pathTextExpr(column: string, path: JsonPathPart[]): string

/** `col -> 'steps' -> 3 ->> 'status'` — the form people type. */
function pathArrowExpr(column: string, path: JsonPathPart[]): string
```

Quoting is the reason this module exists, and it's tested case by case:

- **Column:** quoted as an identifier where it needs it, like `pg-format` `%I`.
- **Path in `#>>`:** a text-array literal. An element containing `,`, `{`,
  `}`, `"`, `\` or whitespace, or that is empty, gets double-quoted and
  escaped inside the array. The whole literal is then single-quoted with
  `'` doubled.
- **Arrow form:** keys are single-quoted literals. Indexes are bare integers.
- **A key that looks like a number** (`"3"` in an object) is a key, not an
  index. The part keeps its type (`string` vs `number`) from the tree, so the
  arrow form writes `-> '3'` for the key and `-> 3` for the index.

These helpers only build text for the clipboard and the SQL preview. The
filter compiler (Part B) builds its own SQL with `pg-format` and never uses
this text.

### Component: `src/components/json/JsonTree.tsx`

```ts
<JsonTree
  value={JsonValue}
  column={string}                          // for path expressions
  source={'jsonb' | 'json' | 'text' | 'blob'}
  onFilter?={(path, leaf, value) => void}  // present only when filterable
/>
```

- **Nodes:** each object and array node collapses. Levels 0–1 open on mount
  and deeper levels start collapsed. Children render only when their parent
  opens, so a large document costs only what's on screen.
- **Big containers:** an object or array with more than 200 children shows
  the first 200 and a *Show N more* row.
- **Previews:** a collapsed node shows a one-line preview (`{3 keys}`,
  `[12 items]`, or the first few keys).
- **Strings:** long strings truncate with *expand*.
- **Row actions on hover or focus:**
  - **Copy path**: `#>>` form, with the arrow form offered next to it;
  - **Copy value**: JSON for a container, the raw text for a scalar;
  - **Filter**: only when `onFilter` is present.
- **Keyboard:** arrow keys move and fold, like a file tree. `c` copies the
  path.
- **Colour:** scalars reuse the existing cell styles, so a string, number,
  `null` and boolean read the same inside the tree as in a cell.
- **Input:** it's built on `jsonForDisplay`, so a text column holding JSON and
  a jsonb column hand the tree the same value.

### Placement

- **Row detail** (`row/$id.tsx`): the *Pretty JSON* checkbox becomes a
  segmented **Tree | Raw** control, with Tree as the default. Raw is today's
  `<pre>`. Choosing Raw is remembered per browser, like the Advanced switch.
  - A compressed column keeps its `CompressionBadge` and `RawBytes` above the
    tree. The tree shows the decoded document.
  - **Filter** on row detail navigates to the table page with the condition
    added to whatever filters the URL already holds.
- **Grid** (`DataTable.tsx`): a JSON cell stays a one-line preview. The
  grid's `prettyJson` `<pre>` path goes away. Clicking the cell opens a
  popover holding the `JsonTree`, and there **Filter** adds the condition to
  the current page's filters without navigating.

## Part B — filter by path

### Model

`Condition` gets one optional field, next to `chain`:

```ts
interface JsonPathFilter {
  path: JsonPathPart[]
  /** What was clicked. It picks the operators and how the value is compared. */
  leaf: JsonLeafKind
}

interface Condition {
  // …existing
  jsonPath?: JsonPathFilter
}
```

- **One or the other.** A condition has a `chain` or a `jsonPath`, never
  both. `chain` follows the column's foreign key, and a json column is never
  a key. The decoder drops any condition that claims both.
- **Kind.** `kindForType` still says `json`, but with a `jsonPath` the kind
  comes from the leaf. A new `operatorsForJsonLeaf(leaf)` replaces
  `operatorsForType` for these conditions:

| Leaf | Operators |
|---|---|
| `string` | `eq`, `ne`, `contains`, `startsWith`, `in`, `notIn`, `isNull`, `notNull` |
| `number` | `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `between`, `isNull`, `notNull` |
| `boolean` | `eq`, `isNull`, `notNull` |
| `null` | `isNull`, `notNull` |
| `object` / `array` | `hasKey`, `isNull`, `notNull` |

- **New operator: `hasKey`** (arity 1). It means "the node at this path has
  this key". It's only offered with a `jsonPath`, and never for a plain
  column.
- **`isNull` on a path** means the path is absent *or* holds JSON `null`.
  That's what `#>>` returning SQL `NULL` means, and the help text says so
  rather than splitting the two.

### Compilation (`src/server/filter-sql.ts`)

One new branch, before the chain branch. Paths and values always go through
`format('%L')` and are never interpolated.

- **Always correct, never index-served:** the extraction
  `(col #>> ARRAY[…]::text[])`, compared as text. A number leaf casts it to
  `::numeric`, and a boolean compares to `'true'` / `'false'`.
- **Faster where it applies:** `eq` on a `jsonb` column whose path has **no
  array index** compiles to containment instead:

  ```sql
  payload @> '{"steps":{"status":"failed"}}'::jsonb
  ```

  A GIN index on the column (default or `jsonb_path_ops`) can serve `@>`,
  and nothing but an expression index can serve `#>>`.
  - The document is built from the path and the leaf. `"failed"` stays a
    string and `3` stays a number, which is why the leaf is carried.
  - An array index can't be used in `@>`, because containment ignores array
    position. Nor can a `json` column, since `@>` is jsonb-only. Both use the
    extraction.
- **`hasKey`:** `(col #> ARRAY[…parent]) ? key` on jsonb. On `json`, it's
  `(col #> …)::jsonb ? key`.
- **SQL preview and plan line:** they show whichever form was chosen.
  `warningsFor` learns that a path condition compiled to extraction reads
  every row, the same way it already flags an unanchored `contains`.

### URL

The codec in `filter-model.ts` gets a second marked segment, following
the chain precedent:

```
payload~eq~#steps/3/status:string~failed
```

- **Separators:** `#` opens the path, `/` separates parts, and `:` ends it
  with the leaf kind.
- **Part types:** a numeric part is an index. A key that looks numeric is
  written as `'3` so it stays a key.
- **Escaping:** the existing backslash rules apply to all three separators.
- **Old URLs:** no operator starts with `#`, so old URLs still decode. A
  value that begins with `#` is escaped the way `@` already is.

### Filter panel

- **`ConditionRow`:** shows the path as breadcrumb chips after the column
  name (`payload › steps › 3 › status`), with the leaf kind as a small tag.
- **Editing the path:** the chips are editable. Click one to rename it, or
  add a part at the end. A path can be written without first finding a row
  that has it. Editing a path keeps the leaf kind unless the user changes it
  from the tag.
- **`ValuePicker`:** not offered for path conditions. Its distinct-values
  query is per column, and making it per path is a separate feature.

## Error handling

- **The tree on a huge or deep document:** the tree only renders what's open,
  so no hard stop. Past `MAX_JSON_TEXT_CHARS` a text column is still not
  parsed (unchanged), and it shows as today.
- **A number leaf compared to text that isn't a number** (one row has
  `"status": "n/a"` where others have numbers): the `::numeric` cast would
  fail the whole query. So the numeric comparison is guarded with
  `CASE WHEN jsonb_typeof(col #> path) = 'number' THEN (col #>> path)::numeric END`
  on jsonb, and on json the `json_typeof` equivalent. A row where it isn't a
  number doesn't match, and the query doesn't fail.
- **Hand-edited URLs:** a path that doesn't decode drops the condition, the
  same as a bad chain.

## Testing

- `tests/lib/json-path.test.ts`:
  - both copy forms;
  - every quoting case (`,`, `{}`, `"`, `\`, `'`, whitespace, empty key,
    unicode);
  - numeric key vs index.
- `tests/lib/filter-model.test.ts`:
  - the URL round-trip with a `jsonPath`;
  - a numeric-looking key surviving;
  - `#` in a value;
  - old URLs still decoding;
  - `chain` + `jsonPath` rejected;
  - `operatorsForJsonLeaf`.
- `tests/server/filter-sql.test.ts`, one case per leaf and operator:
  - `@>` chosen for jsonb `eq` without an index, and extraction for a path
    with an index;
  - extraction on `json`;
  - the numeric guard;
  - `hasKey` on both types.
- `JsonTree`:
  - fold/unfold;
  - *Show more*;
  - copy path passes the right parts;
  - no Filter action when `onFilter` is absent (text and blob).

## Deliberately not built

- Filtering text-JSON or decoded `bytea` columns. See the table at the top.
- SQL/JSON path expressions (`@?`, `jsonb_path_query`). The tree gives a
  path, and a path covers what people click.
- Editing JSON in the tree. Row edit has its own editor.
- Inferring the keys seen across rows. That's a sampling feature with its own
  cost question.
- A per-path `ValuePicker`.
