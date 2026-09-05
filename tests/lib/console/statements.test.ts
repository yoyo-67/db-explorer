import { describe, expect, it } from 'vitest'
import {
  isWriteStatement,
  placeholders,
  splitStatements,
  statementAt,
  tableRefs,
} from '#/lib/console/statements'

/**
 * The reader is a lexer, not a parser: it has to be exactly right about where
 * strings and comments are, and only approximately right about everything else.
 * These tests are mostly about the first half.
 */
describe('splitStatements', () => {
  it('reads a lone statement, semicolon or not', () => {
    expect(splitStatements('SELECT 1')).toEqual([{ from: 0, to: 8, text: 'SELECT 1' }])
    expect(splitStatements('SELECT 1;')).toEqual([{ from: 0, to: 8, text: 'SELECT 1' }])
  })

  it('splits on the semicolons between statements', () => {
    const parts = splitStatements('SELECT 1; SELECT 2')
    expect(parts.map((s) => s.text)).toEqual(['SELECT 1', 'SELECT 2'])
    expect(parts[1].from).toBe(10)
  })

  it('drops a run of empty statements rather than reporting blanks', () => {
    expect(splitStatements(';;\n;  ;')).toEqual([])
    expect(splitStatements('SELECT 1;;SELECT 2').map((s) => s.text)).toEqual([
      'SELECT 1',
      'SELECT 2',
    ])
  })

  it('leaves a semicolon inside a string alone', () => {
    const parts = splitStatements(`SELECT ';'; SELECT 2`)
    expect(parts.map((s) => s.text)).toEqual([`SELECT ';'`, 'SELECT 2'])
  })

  it("keeps a doubled quote inside a string a quote, not a close", () => {
    const parts = splitStatements(`SELECT 'it''s; fine'; SELECT 2`)
    expect(parts.map((s) => s.text)).toEqual([`SELECT 'it''s; fine'`, 'SELECT 2'])
  })

  it('honours a backslash escape only in an E-string', () => {
    // E'\'' is one string holding a quote; the trailing ; ends the statement.
    const parts = splitStatements(`SELECT E'\\';'; SELECT 2`)
    expect(parts.map((s) => s.text)).toEqual([`SELECT E'\\';'`, 'SELECT 2'])
  })

  it('leaves a semicolon inside a quoted identifier alone', () => {
    const parts = splitStatements('SELECT "od;d"; SELECT 2')
    expect(parts.map((s) => s.text)).toEqual(['SELECT "od;d"', 'SELECT 2'])
  })

  it('reads a dollar-quoted body whole, tag and all', () => {
    const sql = "SELECT $fn$ begin; end; $fn$; SELECT 2"
    expect(splitStatements(sql).map((s) => s.text)).toEqual([
      'SELECT $fn$ begin; end; $fn$',
      'SELECT 2',
    ])
  })

  it('does not mistake a placeholder for a dollar quote', () => {
    expect(splitStatements('SELECT $1; SELECT 2').map((s) => s.text)).toEqual([
      'SELECT $1',
      'SELECT 2',
    ])
  })

  it('ignores a semicolon in either kind of comment', () => {
    expect(splitStatements('SELECT 1 -- ; no\n; SELECT 2').map((s) => s.text)).toEqual([
      'SELECT 1 -- ; no',
      'SELECT 2',
    ])
    expect(splitStatements('SELECT /* ; */ 1; SELECT 2').map((s) => s.text)).toEqual([
      'SELECT /* ; */ 1',
      'SELECT 2',
    ])
  })

  it('nests block comments the way Postgres does', () => {
    const sql = 'SELECT /* a /* b ; */ c ; */ 1; SELECT 2'
    expect(splitStatements(sql).map((s) => s.text)).toEqual([
      'SELECT /* a /* b ; */ c ; */ 1',
      'SELECT 2',
    ])
  })

  it('reports offsets into the original buffer, so an error can be placed', () => {
    const sql = '\n\n  SELECT 1;\nSELECT 2'
    const [first, second] = splitStatements(sql)
    expect(sql.slice(first.from, first.to)).toBe('SELECT 1')
    expect(sql.slice(second.from, second.to)).toBe('SELECT 2')
  })
})

describe('statementAt', () => {
  const sql = 'SELECT 1;\nSELECT 2;\nSELECT 3'

  it('finds the statement the cursor sits inside', () => {
    expect(statementAt(sql, 3)?.text).toBe('SELECT 1')
    expect(statementAt(sql, 13)?.text).toBe('SELECT 2')
    expect(statementAt(sql, sql.length)?.text).toBe('SELECT 3')
  })

  it('takes the statement just ended when the cursor is on its semicolon', () => {
    expect(statementAt(sql, 9)?.text).toBe('SELECT 1')
  })

  it('falls back to the preceding statement in the whitespace after one', () => {
    expect(statementAt('SELECT 1;\n\n\n', 11)?.text).toBe('SELECT 1')
  })

  it('has nothing to run in an empty buffer', () => {
    expect(statementAt('   \n  ', 2)).toBeNull()
  })
})

describe('tableRefs', () => {
  it('names the table a FROM introduces', () => {
    expect(tableRefs('SELECT * FROM orders')).toEqual([
      { schema: null, table: 'orders', alias: null },
    ])
  })

  it('takes an alias with or without AS', () => {
    expect(tableRefs('SELECT * FROM orders o')[0].alias).toBe('o')
    expect(tableRefs('SELECT * FROM orders AS o')[0].alias).toBe('o')
  })

  it('splits a schema-qualified name', () => {
    expect(tableRefs('SELECT * FROM public.orders o')).toEqual([
      { schema: 'public', table: 'orders', alias: 'o' },
    ])
  })

  it('unquotes a quoted name', () => {
    expect(tableRefs('SELECT * FROM "public"."Order Log" x')).toEqual([
      { schema: 'public', table: 'Order Log', alias: 'x' },
    ])
  })

  it('collects every table a join chain names', () => {
    const refs = tableRefs(
      'SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN carts',
    )
    expect(refs.map((r) => r.table)).toEqual(['orders', 'customers', 'carts'])
  })

  it('reads the target of an UPDATE, a DELETE and an INSERT', () => {
    expect(tableRefs('UPDATE orders SET x = 1')[0].table).toBe('orders')
    expect(tableRefs('DELETE FROM orders WHERE id = 1')[0].table).toBe('orders')
    expect(tableRefs('INSERT INTO orders (id) VALUES (1)')[0].table).toBe('orders')
  })

  it('never mistakes a keyword after FROM for a table', () => {
    expect(tableRefs('SELECT * FROM (SELECT 1) t')).toEqual([])
    expect(tableRefs('SELECT * FROM ')).toEqual([])
  })

  it('does not read a table out of a string or a comment', () => {
    expect(tableRefs("SELECT 'FROM orders'")).toEqual([])
    expect(tableRefs('SELECT 1 -- FROM orders')).toEqual([])
  })

  it('does not take a following keyword as the alias', () => {
    expect(tableRefs('SELECT * FROM orders WHERE id = 1')[0].alias).toBeNull()
    expect(tableRefs('SELECT * FROM orders ORDER BY id')[0].alias).toBeNull()
    expect(tableRefs('SELECT * FROM orders o JOIN c ON 1=1')[0].alias).toBe('o')
  })
})

describe('placeholders', () => {
  it('lists the parameters a statement uses, once each, in order', () => {
    expect(placeholders('SELECT $2, $1, $1')).toEqual([1, 2])
  })

  it('has none to report when there are none', () => {
    expect(placeholders('SELECT 1')).toEqual([])
  })

  it('ignores a dollar sign inside a string, a comment or a dollar quote', () => {
    expect(placeholders("SELECT '$1'")).toEqual([])
    expect(placeholders('SELECT 1 -- $1')).toEqual([])
    expect(placeholders('SELECT $tag$ $1 $tag$')).toEqual([])
  })
})

describe('tableRefs, comma-separated lists', () => {
  it('reads every table in an implicit join', () => {
    expect(tableRefs('SELECT * FROM carts c, orders o, customers')).toEqual([
      { schema: null, table: 'carts', alias: 'c' },
      { schema: null, table: 'orders', alias: 'o' },
      { schema: null, table: 'customers', alias: null },
    ])
  })

  it('stops at the clause after the list', () => {
    expect(tableRefs('SELECT * FROM a x, b y WHERE x.id = y.id').map((r) => r.table)).toEqual([
      'a',
      'b',
    ])
  })
})

describe('isWriteStatement', () => {
  it('leaves a plain read alone', () => {
    expect(isWriteStatement('SELECT * FROM orders')).toBe(false)
    expect(isWriteStatement('  explain select 1')).toBe(false)
    expect(isWriteStatement('SHOW statement_timeout')).toBe(false)
    expect(isWriteStatement('TABLE orders')).toBe(false)
  })

  it('sees a write for what it is, whatever its case or leading comment', () => {
    expect(isWriteStatement('DELETE FROM orders')).toBe(true)
    expect(isWriteStatement('update orders set x = 1')).toBe(true)
    expect(isWriteStatement('-- careful\nDROP TABLE orders')).toBe(true)
    expect(isWriteStatement('/* one */ CREATE INDEX i ON orders (id)')).toBe(true)
  })

  it('reads a CTE by what its body does, not by how it starts', () => {
    expect(isWriteStatement('WITH recent AS (SELECT 1) SELECT * FROM recent')).toBe(false)
    expect(
      isWriteStatement('WITH gone AS (DELETE FROM orders RETURNING *) SELECT * FROM gone'),
    ).toBe(true)
  })

  it('is not fooled by a write word inside a string or a comment', () => {
    expect(isWriteStatement("SELECT 'delete from orders'")).toBe(false)
    expect(isWriteStatement('SELECT 1 -- delete from orders')).toBe(false)
  })

  it('has nothing to write when there is nothing there', () => {
    expect(isWriteStatement('   ')).toBe(false)
  })
})
