import type { HelpTopic } from '#/lib/help/types'

export const rowNeighborhoodTopic: HelpTopic = {
  id: 'row-neighborhood',
  section: 'Browsing data',
  title: 'Row neighborhood',
  question: 'What is this row attached to, drawn?',
  answer:
    'Starting from one row, the page follows every reference the merged graph knows about: to the rows it points at, and from the rows that point at it, one or two steps out. Each step is one small lookup per value, limited per value, and a child table is only read when an index leads with the referencing column and the table is under 100k rows. Everything else is drawn as a node that says why it was not read.',
  route: '/t/$schema/$table/neighborhood/$id',
  previewCaption: 'One order with its customer, its invoices, and an edge that was not read. Hover a clause to see what it draws.',
  source: {
    file: 'src/server/row-neighborhood.ts',
    line: 27,
    anchor: "format('(SELECT %s FROM %I.%I WHERE %I = %L LIMIT %s)'",
  },
  prerequisite: null,
  steps: [
    {
      id: 'select',
      clause: '(SELECT id::text AS id, name::text AS name',
      title: 'Only what a node shows',
      detail: 'The key, a label column if the table has one (`name`, `title`, `email`, …), and the columns references leave or enter through — as text, so any type draws the same way.',
    },
    {
      id: 'where',
      clause: '   FROM public.invoices WHERE order_id = \'10\'',
      title: 'One value at a time',
      detail: 'Each value gets its own lookup, so the index the gate required can serve it directly.',
    },
    {
      id: 'limit',
      clause: '   LIMIT 6)',
      title: 'Five, and whether there are more',
      detail: 'Six are asked for and five drawn: the sixth only says a "more" node belongs there. How many more is not counted — the node links to the filtered table.',
    },
    {
      id: 'union',
      clause: 'UNION ALL\n(SELECT … WHERE order_id = \'11\' LIMIT 6)',
      title: 'Many values, one statement',
      detail: 'Every value on the same column goes in one statement, run read-only under an 8-second timeout. A statement that runs out becomes "not read — timed out" nodes; the rest of the picture stays.',
    },
  ],
  terms: [
    { term: 'hop', meaning: 'One reference followed. Two hops go on in the same direction: parents of parents, children of children.' },
    { term: 'inferred reference', meaning: 'A link from the model map or a column-name rule rather than a constraint — drawn dashed.' },
  ],
  cost: 'One statement per referenced or referencing column per hop, each an index lookup per value. Loading the merged graph is the same read the lens and Find make.',
}
