import { describe, expectTypeOf, test } from 'vitest'
import type {
  ConnectionConfig,
  TableInfo,
  TableData,
  ColumnInfo,
  AllTablesPreview,
  ForeignKey,
  DocumentConfig,
  DocumentData,
  JsonValue,
} from '#/lib/types'

describe('ConnectionConfig', () => {
  test('has required fields with correct types', () => {
    expectTypeOf<ConnectionConfig['host']>().toBeString()
    expectTypeOf<ConnectionConfig['port']>().toBeNumber()
    expectTypeOf<ConnectionConfig['database']>().toBeString()
    expectTypeOf<ConnectionConfig['user']>().toBeString()
    expectTypeOf<ConnectionConfig['password']>().toBeString()
  })

  test('ssl is optional boolean', () => {
    expectTypeOf<ConnectionConfig['ssl']>().toEqualTypeOf<boolean | undefined>()
  })
})

describe('ColumnInfo', () => {
  test('has name, dataType, isNullable', () => {
    expectTypeOf<ColumnInfo['name']>().toBeString()
    expectTypeOf<ColumnInfo['dataType']>().toBeString()
    expectTypeOf<ColumnInfo['isNullable']>().toBeBoolean()
  })
})

describe('TableInfo', () => {
  test('has name, schema, rowCount, columns', () => {
    expectTypeOf<TableInfo['name']>().toBeString()
    expectTypeOf<TableInfo['schema']>().toBeString()
    expectTypeOf<TableInfo['rowCount']>().toBeNumber()
    expectTypeOf<TableInfo['columns']>().toEqualTypeOf<ColumnInfo[]>()
  })
})

describe('TableData', () => {
  test('has tableName, columns, rows', () => {
    expectTypeOf<TableData['tableName']>().toBeString()
    expectTypeOf<TableData['columns']>().toEqualTypeOf<ColumnInfo[]>()
    expectTypeOf<TableData['rows']>().toEqualTypeOf<Record<string, JsonValue>[]>()
  })
})

describe('AllTablesPreview', () => {
  test('is a record keyed by table name', () => {
    expectTypeOf<AllTablesPreview>().toEqualTypeOf<Record<string, TableData>>()
  })
})

describe('ForeignKey', () => {
  test('has fromTable, fromColumn, toTable, toColumn', () => {
    expectTypeOf<ForeignKey['fromTable']>().toBeString()
    expectTypeOf<ForeignKey['fromColumn']>().toBeString()
    expectTypeOf<ForeignKey['toTable']>().toBeString()
    expectTypeOf<ForeignKey['toColumn']>().toBeString()
  })
})

describe('DocumentConfig', () => {
  test('has rootTable and foreignKeys', () => {
    expectTypeOf<DocumentConfig['rootTable']>().toBeString()
    expectTypeOf<DocumentConfig['foreignKeys']>().toEqualTypeOf<ForeignKey[]>()
  })
})

describe('DocumentData', () => {
  test('has root row and related records', () => {
    expectTypeOf<DocumentData['root']>().toEqualTypeOf<Record<string, JsonValue>>()
    expectTypeOf<DocumentData['related']>().toEqualTypeOf<
      Record<string, Record<string, JsonValue>[]>
    >()
  })
})
