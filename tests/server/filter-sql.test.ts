import { describe, it, expect } from 'vitest'
import {
  buildCountQuery,
  buildMatchQuery,
  buildTableQuery,
  compileCondition,
  compileConditions,
} from '#/server/filter-sql'
import type { Condition, FilterOp } from '#/lib/filter-model'

function cond(column: string, op: FilterOp, values: string[] = [], includeNull?: boolean): Condition {
  return { id: `${column}-${op}`, column, op, values, ...(includeNull ? { includeNull } : {}) }
}

describe('compileCondition — presence', () => {
  it('compiles a null test without touching the value list', () => {
    expect(compileCondition(cond('email', 'isNull'), 'text')).toBe('email IS NULL')
    expect(compileCondition(cond('email', 'notNull'), 'text')).toBe('email IS NOT NULL')
  })
})

describe('compileCondition — comparison', () => {
  it('compares a numeric column natively, so its index still applies', () => {
    expect(compileCondition(cond('age', 'gt', ['10']), 'integer')).toBe(`age > '10'`)
  })

  it('compares a text column natively rather than through a cast', () => {
    expect(compileCondition(cond('name', 'eq', ['alice']), 'text')).toBe(`name = 'alice'`)
  })

  it('compiles a range as a half-open interval', () => {
    expect(compileCondition(cond('created_at', 'between', ['2026-01-01', '2026-02-01']), 'date')).toBe(
      `(created_at >= '2026-01-01' AND created_at < '2026-02-01')`,
    )
  })

  it('quotes an identifier that is not a bare identifier', () => {
    expect(compileCondition(cond('WeirdName', 'eq', ['x']), 'text')).toBe(`"WeirdName" = 'x'`)
  })

  it('escapes a quote inside the value', () => {
    expect(compileCondition(cond('name', 'eq', ["o'brien"]), 'text')).toBe(`name = 'o''brien'`)
  })
})

describe('compileCondition — pattern matching', () => {
  it('anchors a prefix search with LIKE, which a btree index can serve', () => {
    expect(compileCondition(cond('name', 'startsWith', ['ali']), 'text')).toBe(`name LIKE 'ali%'`)
  })

  it('compiles a substring search to ILIKE, without a cast on a text column', () => {
    expect(compileCondition(cond('name', 'contains', ['ali']), 'text')).toBe(`name ILIKE '%ali%'`)
  })

  it('anchors a suffix search at the end only', () => {
    expect(compileCondition(cond('name', 'endsWith', ['son']), 'text')).toBe(`name ILIKE '%son'`)
  })

  it('escapes LIKE wildcards inside the value, so they match themselves', () => {
    // pg-format writes a backslash-carrying literal as an E-string, where the
    // doubled backslashes are one backslash each to LIKE.
    expect(compileCondition(cond('path', 'contains', ['50%_off']), 'text')).toBe(
      `path ILIKE E'%50\\\\%\\\\_off%'`,
    )
  })

  it('casts a non-text column before matching a pattern against it', () => {
    expect(compileCondition(cond('id', 'contains', ['42']), 'integer')).toBe(
      `id::text ILIKE '%42%'`,
    )
  })

  it('compiles a regex against text without a cast', () => {
    expect(compileCondition(cond('slug', 'regex', ['^a']), 'text')).toBe(`slug ~ '^a'`)
  })

  it('casts before a regex on a non-text column', () => {
    expect(compileCondition(cond('id', 'regex', ['^4']), 'integer')).toBe(`id::text ~ '^4'`)
  })
})

describe('compileCondition — set membership', () => {
  it('compiles a value list to a single IN, not a chain of ORs', () => {
    expect(compileCondition(cond('status', 'in', ['a', 'b']), 'text')).toBe(
      `status IN ('a', 'b')`,
    )
  })

  it('ORs in a null test when the null member is picked', () => {
    expect(compileCondition(cond('status', 'in', ['a'], true), 'text')).toBe(
      `(status IN ('a') OR status IS NULL)`,
    )
  })

  it('compiles a null-only selection to a bare null test', () => {
    expect(compileCondition(cond('status', 'in', [], true), 'text')).toBe('status IS NULL')
  })

  it('keeps nulls out of an exclusion unless they are asked for', () => {
    expect(compileCondition(cond('status', 'notIn', ['a']), 'text')).toBe(
      `status NOT IN ('a')`,
    )
  })

  it('keeps null rows in an exclusion when the null member is picked, which NOT IN drops', () => {
    expect(compileCondition(cond('status', 'notIn', ['a'], true), 'text')).toBe(
      `(status NOT IN ('a') OR status IS NULL)`,
    )
  })
})

describe('compileCondition — types with no equality against a literal', () => {
  it('matches an array column as text rather than failing on the literal', () => {
    expect(compileCondition(cond('proacl', 'contains', ['postgres']), 'ARRAY')).toBe(
      `proacl::text ILIKE '%postgres%'`,
    )
  })

  it('matches a user-defined column as text', () => {
    expect(compileCondition(cond('indpred', 'eq', ['unit']), 'USER-DEFINED')).toBe(
      `indpred::text = 'unit'`,
    )
  })

  it('casts when the column type is unknown', () => {
    expect(compileCondition(cond('mystery', 'in', ['x']))).toBe(`mystery::text IN ('x')`)
  })

  it('leaves an oid column comparing natively', () => {
    expect(compileCondition(cond('oid', 'in', ['1259']), 'oid')).toBe(`oid IN ('1259')`)
  })
})

describe('compileConditions', () => {
  it('returns an empty clause when there is nothing to filter on', () => {
    expect(compileConditions([], {})).toBe('')
  })

  it('joins conditions with AND', () => {
    const sql = compileConditions(
      [cond('age', 'gt', ['10']), cond('name', 'contains', ['alice'])],
      { age: 'integer', name: 'text' },
    )
    expect(sql).toBe(`age > '10' AND name ILIKE '%alice%'`)
  })

  it('takes two conditions on one column as a range, both applied', () => {
    const sql = compileConditions([cond('qty', 'gte', ['1']), cond('qty', 'lt', ['9'])], {
      qty: 'integer',
    })
    expect(sql).toBe(`qty >= '1' AND qty < '9'`)
  })

  it('skips a condition that is missing a value', () => {
    const sql = compileConditions([cond('age', 'gt', ['10']), cond('name', 'eq', [''])], {
      age: 'integer',
      name: 'text',
    })
    expect(sql).toBe(`age > '10'`)
  })
})

describe('buildTableQuery', () => {
  it('builds an unfiltered page, one clause per line', () => {
    expect(
      buildTableQuery({ schema: 'public', table: 'orders', conditions: [], columnTypes: {}, limit: 50, offset: 0 }),
    ).toBe(['SELECT *', 'FROM public.orders', 'LIMIT 50 OFFSET 0'].join('\n'))
  })

  it('adds the WHERE clause the conditions compile to', () => {
    const sql = buildTableQuery({
      schema: 'public',
      table: 'orders',
      conditions: [cond('qty', 'gt', ['10'])],
      columnTypes: { qty: 'integer' },
      limit: 50,
      offset: 100,
    })
    expect(sql).toBe(
      ['SELECT *', 'FROM public.orders', `WHERE qty > '10'`, 'LIMIT 50 OFFSET 100'].join('\n'),
    )
  })

  it('puts each further condition on its own AND line', () => {
    const sql = buildTableQuery({
      schema: 'public',
      table: 'orders',
      conditions: [cond('qty', 'gt', ['10']), cond('status', 'eq', ['open'])],
      columnTypes: { qty: 'integer', status: 'text' },
      limit: 50,
      offset: 0,
    })
    expect(sql).toBe(
      [
        'SELECT *',
        'FROM public.orders',
        `WHERE qty > '10'`,
        `  AND status = 'open'`,
        'LIMIT 50 OFFSET 0',
      ].join('\n'),
    )
  })

  it('adds the sort between the filter and the page window', () => {
    const sql = buildTableQuery({
      schema: 'public',
      table: 'orders',
      conditions: [cond('qty', 'gt', ['10'])],
      columnTypes: { qty: 'integer' },
      sort: { column: 'created_at', direction: 'desc' },
      limit: 50,
      offset: 0,
    })
    expect(sql).toBe(
      [
        'SELECT *',
        'FROM public.orders',
        `WHERE qty > '10'`,
        'ORDER BY created_at DESC',
        'LIMIT 50 OFFSET 0',
      ].join('\n'),
    )
  })

  it('quotes a schema and table that need it', () => {
    const sql = buildTableQuery({
      schema: 'Public',
      table: 'Order Lines',
      conditions: [],
      columnTypes: {},
      limit: 1,
      offset: 0,
    })
    expect(sql).toBe(['SELECT *', 'FROM "Public"."Order Lines"', 'LIMIT 1 OFFSET 0'].join('\n'))
  })
})

describe('buildCountQuery', () => {
  it('counts under the same WHERE clause the page runs', () => {
    const args = {
      schema: 'public',
      table: 'orders',
      conditions: [cond('qty', 'gt', ['10'])],
      columnTypes: { qty: 'integer' },
    }
    expect(buildCountQuery(args)).toBe(
      ['SELECT COUNT(*)::bigint AS c', 'FROM public.orders', `WHERE qty > '10'`].join('\n'),
    )
    expect(buildTableQuery({ ...args, limit: 50, offset: 0 })).toContain(`WHERE qty > '10'`)
  })
})

describe('buildMatchQuery', () => {
  it('drops the page window, so a plan estimates every matching row', () => {
    expect(
      buildMatchQuery({
        schema: 'public',
        table: 'orders',
        conditions: [cond('qty', 'gt', ['10'])],
        columnTypes: { qty: 'integer' },
      }),
    ).toBe(['SELECT *', 'FROM public.orders', `WHERE qty > '10'`].join('\n'))
  })

  it('drops the sort too, which costs nothing to know about a row count', () => {
    expect(
      buildMatchQuery({
        schema: 'public',
        table: 'orders',
        conditions: [],
        columnTypes: {},
        sort: { column: 'id', direction: 'desc' },
      }),
    ).toBe(['SELECT *', 'FROM public.orders'].join('\n'))
  })
})

describe('chained conditions', () => {
  const PRESET_TO_PROJECT = [
    { table: 'data_template', keyColumn: 'id', viaColumn: 'project_id' },
    { table: 'data_project', keyColumn: 'id' },
  ]

  it('emits a semi-join, and no join at all for a single hop', () => {
    const sql = buildTableQuery({
      schema: 'public',
      table: 'data_projecttemplate',
      conditions: [
        {
          id: '1',
          column: 'preset_id',
          op: 'in',
          values: ['41b1edf8'],
          chain: PRESET_TO_PROJECT,
        },
      ],
      columnTypes: {},
      limit: 50,
      offset: 0,
    })
    expect(sql).toContain(
      `WHERE preset_id IN (SELECT t1.id FROM public.data_template t1 WHERE t1.project_id IN ('41b1edf8'))`,
    )
    expect(sql).not.toContain('JOIN')
  })

  it('adds one join per further hop, comparing on the last key it already holds', () => {
    const sql = buildTableQuery({
      schema: 'public',
      table: 'data_projecttemplate',
      conditions: [
        {
          id: '1',
          column: 'preset_id',
          op: 'in',
          values: ['c0'],
          chain: [
            { table: 'data_template', keyColumn: 'id', viaColumn: 'project_id' },
            { table: 'data_project', keyColumn: 'id', viaColumn: 'company_id' },
            { table: 'data_company', keyColumn: 'id' },
          ],
        },
      ],
      columnTypes: {},
      limit: 50,
      offset: 0,
    })
    expect(sql).toContain(
      'SELECT t1.id FROM public.data_template t1' +
        ' JOIN public.data_project t2 ON t2.id = t1.project_id' +
        ` WHERE t2.company_id IN ('c0')`,
    )
  })

  it('qualifies the compared column, so a shared column name cannot be ambiguous', () => {
    const sql = buildTableQuery({
      schema: 'public',
      table: 'child',
      conditions: [
        {
          id: '1',
          column: 'id',
          op: 'in',
          values: ['x'],
          chain: [
            { table: 'mid', keyColumn: 'id', viaColumn: 'id' },
            { table: 'far', keyColumn: 'id' },
          ],
        },
      ],
      columnTypes: {},
      limit: 50,
      offset: 0,
    })
    expect(sql).toContain(`WHERE t1.id IN ('x')`)
  })

  it('quotes every identifier the chain names', () => {
    const sql = buildTableQuery({
      schema: 'public',
      table: 'child',
      conditions: [
        {
          id: '1',
          column: 'ref id',
          op: 'in',
          values: ['x'],
          chain: [
            { table: 'odd table', keyColumn: 'the key', viaColumn: 'via col' },
            { table: 'far', keyColumn: 'id' },
          ],
        },
      ],
      columnTypes: {},
      limit: 50,
      offset: 0,
    })
    expect(sql).toContain(
      `"ref id" IN (SELECT t1."the key" FROM public."odd table" t1 WHERE t1."via col" IN ('x'))`,
    )
  })

  it('skips a chained condition when there is no schema to name its tables in', () => {
    expect(
      compileConditions(
        [
          {
            id: '1',
            column: 'preset_id',
            op: 'in',
            values: ['x'],
            chain: PRESET_TO_PROJECT,
          },
        ],
        {},
      ),
    ).toBe('')
  })
})
