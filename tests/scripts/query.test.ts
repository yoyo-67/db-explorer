import { describe, expect, it } from 'vitest'
import { formatResult, parseQueryArgs, readOnlySessionOptions, runReadOnly } from '../../scripts/lib/query.mjs'

describe('query CLI arguments', () => {
  it('takes the SQL as the one positional argument, with table output and default limits', () => {
    expect(parseQueryArgs(['select 1'])).toEqual({
      sql: 'select 1',
      preset: null,
      database: null,
      format: 'table',
      limit: 200,
      timeoutMs: 30_000,
    })
  })

  it('reads flags: preset, database, format, limit and timeout in seconds', () => {
    expect(
      parseQueryArgs(['--preset', 'netlab remote', '--database', 'netlab', '--json', '--limit', '5', '--timeout', '10', 'select 1']),
    ).toMatchObject({ sql: 'select 1', preset: 'netlab remote', database: 'netlab', format: 'json', limit: 5, timeoutMs: 10_000 })
    expect(parseQueryArgs(['--csv', 'select 1']).format).toBe('csv')
  })

  it('takes `-` for SQL read from stdin, and refuses no SQL or two', () => {
    expect(parseQueryArgs(['-']).sql).toBe('-')
    expect(() => parseQueryArgs([])).toThrow(/SQL/)
    expect(() => parseQueryArgs(['select 1', 'select 2'])).toThrow(/one/)
    expect(() => parseQueryArgs(['--limit', 'many', 'select 1'])).toThrow(/--limit/)
    expect(() => parseQueryArgs(['--nope', 'select 1'])).toThrow(/--nope/)
  })
})

describe('read-only session', () => {
  it('makes every transaction of the session read-only and bounds each statement', () => {
    expect(readOnlySessionOptions(30_000)).toBe('-c default_transaction_read_only=on -c statement_timeout=30000')
  })

  it('runs the statement in a read-only transaction, by the extended protocol, and always rolls back', async () => {
    const calls: unknown[] = []
    const client = {
      query: async (q: unknown) => {
        calls.push(q)
        return typeof q === 'object' ? { fields: [{ name: 'n' }], rows: [{ n: 1 }], rowCount: 1, command: 'SELECT' } : {}
      },
    }
    const result = await runReadOnly(client, 'select 1 as n')
    expect(result.rows).toEqual([{ n: 1 }])
    // `queryMode` forces the extended protocol (pg sends an empty `values` by the simple one), which refuses a second statement smuggled after the first.
    expect(calls).toEqual(['BEGIN READ ONLY', { text: 'select 1 as n', values: [], queryMode: 'extended' }, 'ROLLBACK'])
  })

  it('rolls back when the statement fails, and passes the failure on', async () => {
    const calls: unknown[] = []
    const client = {
      query: async (q: unknown) => {
        calls.push(q)
        if (typeof q === 'object') throw new Error('cannot execute DELETE in a read-only transaction')
        return {}
      },
    }
    await expect(runReadOnly(client, 'delete from t')).rejects.toThrow(/read-only/)
    expect(calls.at(-1)).toBe('ROLLBACK')
  })
})

describe('query output', () => {
  const result = {
    command: 'SELECT',
    rowCount: 3,
    fields: [{ name: 'id' }, { name: 'email' }, { name: 'meta' }],
    rows: [
      { id: 1, email: 'a@x.io', meta: { plan: 'pro' } },
      { id: 22, email: null, meta: null },
      { id: 3, email: 'c, "d"', meta: null },
    ],
  }

  it('draws an aligned table with the row count, nulls shown as NULL and objects as JSON', () => {
    expect(formatResult(result, { format: 'table', limit: 200 })).toBe(
      [
        'id | email  | meta',
        '---+--------+---------------',
        '1  | a@x.io | {"plan":"pro"}',
        '22 | NULL   | NULL',
        '3  | c, "d" | NULL',
        '(3 rows)',
      ].join('\n'),
    )
  })

  it('cuts at the limit and says how many rows were left out', () => {
    expect(formatResult(result, { format: 'table', limit: 1 }).split('\n').slice(-1)[0]).toBe('(3 rows, first 1 shown; --limit to see more)')
    expect(JSON.parse(formatResult(result, { format: 'json', limit: 2 }))).toEqual({
      rowCount: 3,
      truncated: true,
      rows: result.rows.slice(0, 2),
    })
  })

  it('writes CSV with quoting where a value needs it', () => {
    expect(formatResult(result, { format: 'csv', limit: 200 })).toBe(
      ['id,email,meta', '1,a@x.io,"{""plan"":""pro""}"', '22,,', '3,"c, ""d""",'].join('\n'),
    )
  })

  it('reports a statement with no rows by its command', () => {
    expect(formatResult({ command: 'SHOW', rowCount: null, fields: [], rows: [] }, { format: 'table', limit: 200 })).toBe('SHOW')
  })
})
