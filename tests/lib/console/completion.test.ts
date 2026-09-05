import { describe, expect, it } from 'vitest'
import { completeAt, type ConsoleSchema } from '#/lib/console/completion'
import type { ColumnInfo, TableInfo } from '#/lib/types'

function col(name: string, dataType = 'text'): ColumnInfo {
  return { name, dataType, isNullable: true }
}

function table(name: string, columns: string[]): TableInfo {
  return {
    name,
    schema: 'public',
    kind: 'table',
    rowCount: 0,
    lastModified: null,
    columns: columns.map((c) => col(c)),
    pkColumn: 'id',
  }
}

const schema: ConsoleSchema = {
  schema: 'public',
  tables: [
    table('orders', ['id', 'customer_id', 'total_cents']),
    table('customers', ['id', 'email', 'created_at']),
    table('data_recordingpipeline', ['id', 'started_at']),
  ],
  fks: [
    { fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id' },
    {
      fromTable: 'data_recordingpipeline',
      fromColumn: 'id',
      toTable: 'orders',
      toColumn: 'id',
      basis: 'convention',
    },
  ],
  models: { data_recordingpipeline: 'VideoPositioningPipeline' },
}

/** `completeAt` is given the whole buffer and a cursor, the way the editor has
 *  them; every test here writes the cursor as `|` and splits on it. */
function complete(withCursor: string) {
  const cursor = withCursor.indexOf('|')
  const sql = withCursor.replace('|', '')
  return completeAt(schema, sql, cursor)
}

const labels = (withCursor: string) => complete(withCursor)?.options.map((o) => o.label) ?? []

describe('completing a table name', () => {
  it('offers tables after FROM', () => {
    expect(labels('SELECT * FROM |')).toContain('orders')
  })

  it('offers tables after every join keyword', () => {
    expect(labels('SELECT * FROM orders o LEFT JOIN |')).toContain('customers')
    expect(labels('UPDATE |')).toContain('orders')
    expect(labels('INSERT INTO |')).toContain('orders')
  })

  it('replaces the partial word rather than appending to it', () => {
    const result = complete('SELECT * FROM cust|')
    expect(result?.from).toBe(14)
    expect(result?.options[0].label).toBe('customers')
  })

  it('finds a table by the model name printed everywhere else', () => {
    const options = complete('SELECT * FROM VideoPositioning|')?.options ?? []
    expect(options[0].label).toBe('data_recordingpipeline')
    // The model is why it matched, so the row has to say so.
    expect(options[0].detail).toContain('VideoPositioningPipeline')
  })

  it('does not offer a column where only a table can go', () => {
    expect(labels('SELECT * FROM |')).not.toContain('customer_id')
  })
})

describe('completing a column name', () => {
  it('offers the columns of a table named by its alias', () => {
    expect(labels('SELECT o.| FROM orders o')).toEqual([
      'id',
      'customer_id',
      'total_cents',
    ])
  })

  it('offers the columns of a table named in full', () => {
    expect(labels('SELECT orders.| FROM orders')).toContain('total_cents')
  })

  it('says what type a column is, so a cast is not a guess', () => {
    const options = complete('SELECT o.| FROM orders o')?.options ?? []
    expect(options[0].detail).toBe('text')
  })

  it('offers every named table’s columns where a bare name can go', () => {
    const found = labels('SELECT | FROM orders o JOIN customers c ON c.id = o.customer_id')
    expect(found).toContain('total_cents')
    expect(found).toContain('email')
  })

  it('has nothing to offer for an alias the statement never bound', () => {
    expect(labels('SELECT zz.| FROM orders o')).toEqual([])
  })

  it('reads the tables out of the statement the cursor is in, not its neighbours', () => {
    expect(labels('SELECT * FROM customers;\nSELECT o.| FROM orders o')).toContain(
      'total_cents',
    )
    expect(labels('SELECT * FROM customers;\nSELECT o.| FROM orders o')).not.toContain(
      'email',
    )
  })
})

describe('completing a join', () => {
  it('leads with the tables a foreign key can reach, and writes the ON clause', () => {
    const options = complete('SELECT * FROM orders o JOIN |')?.options ?? []
    expect(options[0].label).toBe('customers')
    expect(options[0].insert).toBe('customers c ON c.id = o.customer_id')
  })

  it('joins back down a foreign key that points the other way', () => {
    const options = complete('SELECT * FROM customers c JOIN |')?.options ?? []
    expect(options[0].insert).toBe('orders o ON o.customer_id = c.id')
  })

  it('says when the link is a hand-written claim rather than a constraint', () => {
    const options = complete('SELECT * FROM orders o JOIN data_rec|')?.options ?? []
    expect(options[0].detail).toContain('convention')
  })

  it('does not hand out an alias the statement is already using', () => {
    const options = complete('SELECT * FROM carts c, orders o JOIN cust|')?.options ?? []
    expect(options[0].insert).toBe('customers c2 ON c2.id = o.customer_id')
  })

  it('still offers unreachable tables, just not first', () => {
    const labelled = labels('SELECT * FROM orders o JOIN |')
    expect(labelled).toContain('data_recordingpipeline')
    expect(labelled[0]).toBe('customers')
  })
})

describe('completing a keyword', () => {
  it('offers clause keywords where one can go', () => {
    expect(labels('SELECT * FROM orders WHE|')).toContain('WHERE')
  })

  it('never offers a keyword after a dot', () => {
    expect(labels('SELECT o.wh| FROM orders o')).not.toContain('WHERE')
  })
})

describe('not completing', () => {
  it('stays out of a string and a comment', () => {
    expect(complete("SELECT 'cust|'")).toBeNull()
    expect(complete('SELECT 1 -- cust|')).toBeNull()
  })
})

/**
 * The position people are actually in most of the time: somewhere in a clause,
 * having already said which tables the query is about. The columns of those
 * tables are the answer, and they have to come before anything else.
 */
describe('completing inside a clause', () => {
  it('offers the columns of the query’s tables in a WHERE', () => {
    const found = labels('SELECT * FROM orders o WHERE |')
    expect(found.slice(0, 3)).toEqual(['id', 'customer_id', 'total_cents'])
  })

  it('narrows those columns as you type', () => {
    expect(labels('SELECT * FROM orders o WHERE tot|')[0]).toBe('total_cents')
  })

  it('offers both tables’ columns in a WHERE over a join', () => {
    const found = labels(
      'SELECT * FROM orders o JOIN customers c ON c.id = o.customer_id WHERE |',
    )
    expect(found).toContain('total_cents')
    expect(found).toContain('email')
  })

  it('offers columns in an ON, a GROUP BY and an ORDER BY too', () => {
    expect(labels('SELECT * FROM orders o GROUP BY |')).toContain('customer_id')
    expect(labels('SELECT * FROM orders o ORDER BY |')).toContain('total_cents')
    expect(labels('SELECT * FROM orders o JOIN customers c ON |')).toContain('email')
  })

  it('still offers a qualified column in a WHERE', () => {
    expect(labels('SELECT * FROM orders o WHERE o.|')).toEqual([
      'id',
      'customer_id',
      'total_cents',
    ])
  })

  it('puts columns before tables, because a bare name in a clause is a column', () => {
    const found = labels('SELECT * FROM customers c WHERE |')
    expect(found.indexOf('email')).toBeLessThan(found.indexOf('orders'))
  })
})
