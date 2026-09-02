import { describe, expect, it } from 'vitest'
import {
  TOAST_THRESHOLD_BYTES,
  likelyToastColumn,
  sizeSplit,
  storageNote,
  storageOverridden,
} from '#/lib/physical/storage'
import type { PhysicalColumn } from '#/lib/physical/types'

function varlena(overrides: Partial<PhysicalColumn> & { name: string }): PhysicalColumn {
  return {
    attnum: 1,
    dropped: false,
    type: 'bytea',
    typlen: -1,
    align: 'i',
    typstorage: 'x',
    storage: 'x',
    compression: null,
    notNull: false,
    avgWidth: TOAST_THRESHOLD_BYTES * 2,
    nullFraction: 0,
    ...overrides,
  }
}

describe('storageNote', () => {
  it('flags a wide bytea that Postgres will try to compress again', () => {
    const note = storageNote('public', 'blobs', varlena({ name: 'payload' }))
    expect(note?.kind).toBe('double-compression')
    expect(note?.ddl).toBe(
      'ALTER TABLE public.blobs ALTER COLUMN payload SET STORAGE EXTERNAL;',
    )
  })

  it('quotes an identifier the statement would otherwise break on', () => {
    const note = storageNote('public', 'order', varlena({ name: 'from' }))
    expect(note?.ddl).toBe(
      'ALTER TABLE public."order" ALTER COLUMN "from" SET STORAGE EXTERNAL;',
    )
  })

  it('says nothing about a narrow column, where TOAST never comes into it', () => {
    expect(storageNote('public', 'blobs', varlena({ name: 'small', avgWidth: 40 }))).toBeNull()
  })

  it('warns that a plain varlena cannot escape the page', () => {
    const note = storageNote('public', 't', varlena({ name: 'body', type: 'text', storage: 'p' }))
    expect(note?.kind).toBe('plain-risk')
  })
})

describe('storageOverridden', () => {
  it('is true only where somebody moved the column off its type default', () => {
    expect(storageOverridden(varlena({ name: 'a', typstorage: 'x', storage: 'e' }))).toBe(true)
    expect(storageOverridden(varlena({ name: 'a', typstorage: 'x', storage: 'x' }))).toBe(false)
  })
})

describe('sizeSplit', () => {
  it('divides the total into the three places bytes live', () => {
    const split = sizeSplit({
      heapBytes: 100,
      toastBytes: 300,
      indexBytes: 100,
      totalBytes: 500,
    })
    expect(split.toastShare).toBe(0.6)
    expect(split.heapShare).toBe(0.2)
  })

  it('trusts the parts when the reported total is smaller than their sum', () => {
    const split = sizeSplit({ heapBytes: 100, toastBytes: 100, indexBytes: 100, totalBytes: 10 })
    expect(split.totalBytes).toBe(300)
  })

  it('reports nothing rather than dividing by zero on an empty table', () => {
    const split = sizeSplit({ heapBytes: 0, toastBytes: 0, indexBytes: 0, totalBytes: 0 })
    expect(split.toastShare).toBe(0)
  })
})

describe('likelyToastColumn', () => {
  it('picks the widest column allowed out of the heap', () => {
    const columns = [
      varlena({ name: 'small', avgWidth: 100 }),
      varlena({ name: 'big', avgWidth: 90_000 }),
      varlena({ name: 'plain', avgWidth: 200_000, storage: 'p' }),
    ]
    expect(likelyToastColumn(columns)?.name).toBe('big')
  })

  it('has no candidate when nothing is variable-length', () => {
    expect(likelyToastColumn([varlena({ name: 'n', typlen: 8 })])).toBeNull()
  })
})
