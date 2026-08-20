import { describe, expect, it } from 'vitest'
import {
  crossDbRefsForTable,
  enrichColumnsWithCrossDbRefs,
  describeCrossDbTarget,
  resolveCrossDbRef,
  type CrossDbRef,
} from '#/lib/cross-db-refs'

const taskResult = {
  database: 'celery_results',
  schema: 'public',
  table: 'django_celery_results_taskresult',
  column: 'task_id',
}

const schemaWide: CrossDbRef = {
  from: { database: 'app_db', schema: 'public', column: 'celery_task_id' },
  to: taskResult,
  note: 'The result backend lives in its own database',
}

const tableSpecific: CrossDbRef = {
  from: {
    database: 'app_db',
    schema: 'public',
    table: 'app_usergenerateddata',
    column: 'celery_task_id',
  },
  to: { ...taskResult, table: 'django_celery_results_groupresult', column: 'group_id' },
}

describe('resolveCrossDbRef', () => {
  it('matches a column in every table when the rule names no table', () => {
    const found = resolveCrossDbRef([schemaWide], {
      database: 'app_db',
      schema: 'public',
      table: 'app_scheduledjobinstance',
      column: 'celery_task_id',
    })
    expect(found?.to).toEqual(taskResult)
  })

  it('lets a rule naming the table win over the schema-wide one', () => {
    const found = resolveCrossDbRef([schemaWide, tableSpecific], {
      database: 'app_db',
      schema: 'public',
      table: 'app_usergenerateddata',
      column: 'celery_task_id',
    })
    expect(found?.to.table).toBe('django_celery_results_groupresult')
  })

  it('never applies a rule written for another database or schema', () => {
    const elsewhere = { schema: 'public', table: 't', column: 'celery_task_id' }
    expect(resolveCrossDbRef([schemaWide], { ...elsewhere, database: 'other_db' })).toBeNull()
    expect(
      resolveCrossDbRef([schemaWide], { ...elsewhere, database: 'app_db', schema: 'staging' }),
    ).toBeNull()
  })

  it('says nothing about a column no rule mentions', () => {
    expect(
      resolveCrossDbRef([schemaWide], {
        database: 'app_db',
        schema: 'public',
        table: 't',
        column: 'id',
      }),
    ).toBeNull()
  })
})

describe('crossDbRefsForTable', () => {
  it('keys the rules that apply by column', () => {
    const found = crossDbRefsForTable(
      [schemaWide],
      { database: 'app_db', schema: 'public', table: 'app_scheduledjobinstance' },
      ['id', 'celery_task_id', 'status'],
    )
    expect(Object.keys(found)).toEqual(['celery_task_id'])
    expect(found.celery_task_id.note).toBe('The result backend lives in its own database')
  })
})

describe('describeCrossDbTarget', () => {
  it('names the database, and the schema only when it is not public', () => {
    expect(describeCrossDbTarget(taskResult)).toBe(
      'celery_results.django_celery_results_taskresult.task_id',
    )
    expect(describeCrossDbTarget({ ...taskResult, schema: 'archive' })).toBe(
      'celery_results.archive.django_celery_results_taskresult.task_id',
    )
  })
})

describe('enrichColumnsWithCrossDbRefs', () => {
  const columns = [
    { name: 'id', dataType: 'uuid', isNullable: false },
    { name: 'celery_task_id', dataType: 'uuid', isNullable: true },
  ]
  const at = { database: 'app_db', schema: 'public', table: 'app_scheduledjobinstance' }

  it('attaches the target to the column the rule names', () => {
    const enriched = enrichColumnsWithCrossDbRefs(columns, [schemaWide], at)
    expect(enriched[1].crossRef).toEqual({
      ...taskResult,
      note: 'The result backend lives in its own database',
    })
  })

  it('leaves every other column exactly as it was', () => {
    const enriched = enrichColumnsWithCrossDbRefs(columns, [schemaWide], at)
    expect(enriched[0]).toBe(columns[0])
  })

  it('does nothing at all when there are no rules', () => {
    expect(enrichColumnsWithCrossDbRefs(columns, [], at)).toBe(columns)
  })
})
