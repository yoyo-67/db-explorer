import { describe, expectTypeOf, test } from 'vitest'
import type {
  ConnectionConfig,
  TableInfo,
  TableData,
  ColumnInfo,
  ForeignKey,
  IntrospectResult,
  RowDetail,
  RowChildGroup,
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
  test('has name, schema, rowCount, lastModified, columns', () => {
    expectTypeOf<TableInfo['name']>().toBeString()
    expectTypeOf<TableInfo['schema']>().toBeString()
    expectTypeOf<TableInfo['rowCount']>().toBeNumber()
    expectTypeOf<TableInfo['lastModified']>().toEqualTypeOf<string | null>()
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

describe('IntrospectResult', () => {
  test('exposes schema, tables, fks', () => {
    expectTypeOf<IntrospectResult['schema']>().toBeString()
    expectTypeOf<IntrospectResult['tables']>().toEqualTypeOf<TableInfo[]>()
    expectTypeOf<IntrospectResult['fks']>().toEqualTypeOf<ForeignKey[]>()
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

describe('RowDetail', () => {
  test('exposes schema, table, columns, root, children', () => {
    expectTypeOf<RowDetail['schema']>().toBeString()
    expectTypeOf<RowDetail['table']>().toBeString()
    expectTypeOf<RowDetail['columns']>().toEqualTypeOf<ColumnInfo[]>()
    expectTypeOf<RowDetail['root']>().toEqualTypeOf<Record<string, JsonValue> | null>()
    expectTypeOf<RowDetail['children']>().toEqualTypeOf<RowChildGroup[]>()
  })
})

describe('RowChildGroup', () => {
  test('describes one child table grouping with rows + total', () => {
    expectTypeOf<RowChildGroup['table']>().toBeString()
    expectTypeOf<RowChildGroup['fkColumn']>().toBeString()
    expectTypeOf<RowChildGroup['toColumn']>().toBeString()
    expectTypeOf<RowChildGroup['rows']>().toEqualTypeOf<Record<string, JsonValue>[]>()
    expectTypeOf<RowChildGroup['total']>().toBeNumber()
  })
})
