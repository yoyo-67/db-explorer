import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { RowEdit } from '#/lib/row-edit'

const mockQuery = vi.fn()
/** Statements the write transaction was asked to run, in order. */
let written: string[] = []
const runResults: Array<{ rows: unknown[]; rowCount: number }> = []

vi.mock('#/server/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  withWriteTransaction: async (
    body: (run: (sql: string) => Promise<unknown>) => Promise<unknown>,
  ) => {
    return body(async (sql: string) => {
      written.push(sql)
      return runResults.shift() ?? { rows: [], rowCount: 0 }
    })
  },
}))

const { buildLockSql, buildUpdateSql, previewRowUpdate, updateRow } = await import(
  '#/server/row-update'
)

/** The catalog answer for a `users` table, as `resolveEditTarget` reads it. */
function catalogRows(
  overrides: Array<Record<string, unknown>> = [],
  tableType = 'BASE TABLE',
) {
  const base = [
    { column_name: 'id', data_type: 'integer', is_nullable: 'NO', is_generated: 'NEVER', identity_generation: 'BY DEFAULT' },
    { column_name: 'email', data_type: 'character varying', is_nullable: 'NO', is_generated: 'NEVER', identity_generation: null },
    { column_name: 'note', data_type: 'text', is_nullable: 'YES', is_generated: 'NEVER', identity_generation: null },
    { column_name: 'payload', data_type: 'jsonb', is_nullable: 'YES', is_generated: 'NEVER', identity_generation: null },
    { column_name: 'slug', data_type: 'text', is_nullable: 'YES', is_generated: 'ALWAYS', identity_generation: null },
  ]
  return [...base, ...overrides].map((row) => ({ ...row, table_type: tableType }))
}

const edit: RowEdit = {
  schema: 'public',
  table: 'users',
  pkColumn: 'id',
  pkValue: '7',
  changes: [{ column: 'email', from: 'a@b.c', to: 'z@b.c' }],
}

beforeEach(() => {
  mockQuery.mockReset()
  written = []
  runResults.length = 0
})

describe('buildUpdateSql', () => {
  it('sets only the columns that changed, keyed on the primary key', () => {
    expect(buildUpdateSql(edit)).toBe(
      `UPDATE public.users SET email = 'z@b.c' WHERE id = '7' RETURNING *`,
    )
  })

  it('quotes identifiers, so a column named like SQL cannot be SQL', () => {
    const sql = buildUpdateSql({
      ...edit,
      table: 'user"s',
      changes: [{ column: 'drop table', from: null, to: 'x' }],
    })
    expect(sql).toContain('"user""s"')
    expect(sql).toContain('"drop table"')
  })

  it('escapes a value carrying a quote instead of ending the literal', () => {
    const sql = buildUpdateSql({
      ...edit,
      changes: [{ column: 'note', from: null, to: "it's; DROP TABLE users --" }],
    })
    expect(sql).toBe(
      `UPDATE public.users SET note = 'it''s; DROP TABLE users --' WHERE id = '7' RETURNING *`,
    )
  })

  it('writes a cleared field as NULL, not as the string', () => {
    const sql = buildUpdateSql({ ...edit, changes: [{ column: 'note', from: 'x', to: null }] })
    expect(sql).toBe(`UPDATE public.users SET note = NULL WHERE id = '7' RETURNING *`)
  })

  it('sends every value as an untyped literal, leaving the cast to the column', () => {
    const sql = buildUpdateSql({
      ...edit,
      changes: [
        { column: 'payload', from: null, to: '{"a": 1}' },
        { column: 'note', from: null, to: '{a,b}' },
      ],
    })
    expect(sql).toContain(`payload = '{"a": 1}'`)
    expect(sql).toContain(`note = '{a,b}'`)
    expect(sql).not.toContain('::')
  })

  it('returns the row it wrote, so the page can show what landed', () => {
    expect(buildUpdateSql(edit).endsWith('RETURNING *')).toBe(true)
  })
})

describe('buildLockSql', () => {
  it('reads back the columns about to change, and holds the row while it does', () => {
    expect(buildLockSql(edit)).toBe(
      `SELECT email FROM public.users WHERE id = '7' FOR UPDATE`,
    )
  })
})

describe('previewRowUpdate — the statement, checked against the catalog', () => {
  it('returns the statement it would run', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows() })
    await expect(previewRowUpdate(edit)).resolves.toEqual({
      ok: true,
      sql: `UPDATE public.users SET email = 'z@b.c' WHERE id = '7' RETURNING *`,
    })
  })

  it('refuses a table that is not there', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    const result = await previewRowUpdate(edit)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('public.users')
  })

  it('refuses a view: an update to it is a different question', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows([], 'VIEW') })
    const result = await previewRowUpdate(edit)
    expect(result.ok === false && result.error).toContain('view')
  })

  it('refuses a column the table does not have', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows() })
    const result = await previewRowUpdate({
      ...edit,
      changes: [{ column: 'nope', from: null, to: 'x' }],
    })
    expect(result.ok === false && result.error).toContain('nope')
  })

  it('refuses a generated column', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows() })
    const result = await previewRowUpdate({
      ...edit,
      changes: [{ column: 'slug', from: 'a', to: 'b' }],
    })
    expect(result.ok === false && result.error).toContain('slug')
  })

  it('refuses to move the key it is keyed on', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows() })
    const result = await previewRowUpdate({
      ...edit,
      changes: [{ column: 'id', from: '7', to: '8' }],
    })
    expect(result.ok === false && result.error).toContain('id')
  })

  it('refuses a key the table does not have', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows() })
    const result = await previewRowUpdate({ ...edit, pkColumn: 'rowid' })
    expect(result.ok === false && result.error).toContain('rowid')
  })

  it('refuses clearing a NOT NULL column, without asking the database', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows() })
    const result = await previewRowUpdate({
      ...edit,
      changes: [{ column: 'email', from: 'a@b.c', to: null }],
    })
    expect(result.ok === false && result.error).toContain('NOT NULL')
  })

  it('runs nothing — a preview is a catalog read', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows() })
    await previewRowUpdate(edit)
    expect(written).toEqual([])
  })
})

describe('updateRow', () => {
  it('locks the row, checks it is unchanged, then writes exactly one row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows() })
    runResults.push({ rows: [{ email: 'a@b.c' }], rowCount: 1 })
    runResults.push({ rows: [{ id: 7, email: 'z@b.c' }], rowCount: 1 })

    const result = await updateRow(edit)

    expect(written).toEqual([
      `SELECT email FROM public.users WHERE id = '7' FOR UPDATE`,
      `UPDATE public.users SET email = 'z@b.c' WHERE id = '7' RETURNING *`,
    ])
    expect(result).toEqual({
      ok: true,
      sql: `UPDATE public.users SET email = 'z@b.c' WHERE id = '7' RETURNING *`,
      row: { id: 7, email: 'z@b.c' },
    })
  })

  it('names the columns that moved under it, and writes nothing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows() })
    runResults.push({ rows: [{ email: 'someone.else@b.c' }], rowCount: 1 })

    const result = await updateRow(edit)

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.conflicts).toEqual([
      { column: 'email', expected: 'a@b.c', actual: 'someone.else@b.c' },
    ])
    expect(written).toHaveLength(1)
  })

  it('accepts a json field that was only reformatted since the page loaded', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows() })
    runResults.push({ rows: [{ payload: { b: 2, a: 1 } }], rowCount: 1 })
    runResults.push({ rows: [{ id: 7 }], rowCount: 1 })

    const result = await updateRow({
      ...edit,
      changes: [{ column: 'payload', from: '{"a":1,"b":2}', to: '{"a":9}' }],
    })

    expect(result.ok).toBe(true)
  })

  it('says the row is gone when the lock finds nothing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows() })
    runResults.push({ rows: [], rowCount: 0 })

    const result = await updateRow(edit)

    expect(result.ok === false && result.error).toMatch(/no longer|gone/i)
    expect(written).toHaveLength(1)
  })

  it('refuses when the key matches more than one row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows() })
    runResults.push({ rows: [{ email: 'a@b.c' }, { email: 'a@b.c' }], rowCount: 2 })

    const result = await updateRow(edit)

    expect(result.ok === false && result.error).toContain('2 rows')
    expect(written).toHaveLength(1)
  })

  it('refuses when the update itself would touch more than one row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows() })
    runResults.push({ rows: [{ email: 'a@b.c' }], rowCount: 1 })
    runResults.push({ rows: [{ id: 7 }, { id: 8 }], rowCount: 2 })

    const result = await updateRow(edit)

    expect(result.ok === false && result.error).toContain('2 rows')
  })

  it('never reaches the transaction when the catalog check fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows([], 'VIEW') })
    const result = await updateRow(edit)
    expect(result.ok).toBe(false)
    expect(written).toEqual([])
  })

  it('turns driver values into JSON-safe ones, like every other row the app returns', async () => {
    mockQuery.mockResolvedValueOnce({ rows: catalogRows() })
    runResults.push({ rows: [{ email: 'a@b.c' }], rowCount: 1 })
    runResults.push({
      rows: [{ id: 7, created_at: new Date('2026-08-21T00:00:00.000Z') }],
      rowCount: 1,
    })

    const result = await updateRow(edit)

    expect(result.ok === true && result.row).toEqual({
      id: 7,
      created_at: '2026-08-21T00:00:00.000Z',
    })
  })
})
