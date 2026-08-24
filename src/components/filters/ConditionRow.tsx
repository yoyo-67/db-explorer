import ValuePicker from '#/components/filters/ValuePicker'
import { arityForOp, changeOp, defaultOpForType, operatorsForType } from '#/lib/filter-model'
import type { Condition, FilterOp } from '#/lib/filter-model'
import { warningsFor } from '#/lib/filter-plan'
import type { ColumnInfo, ForeignKey } from '#/lib/types'

/** What each operator is called in the panel. Short enough to read as a phrase
 *  with the column name in front of it: `status is one of`. */
export const OP_LABELS: Record<FilterOp, string> = {
  eq: 'is',
  ne: 'is not',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  between: 'between',
  in: 'is one of',
  notIn: 'is none of',
  startsWith: 'starts with',
  contains: 'contains',
  endsWith: 'ends with',
  regex: 'matches regex',
  isNull: 'is null',
  notNull: 'is not null',
}

/**
 * One line of the filter: column, operator, and whatever the operator needs
 * typing or ticking into it. The operator list comes from the column's type, so
 * the panel can only build filters the compiler can emit.
 */
export default function ConditionRow({
  condition,
  columns,
  fks,
  schema,
  table,
  otherConditions,
  onChange,
  onRemove,
}: {
  condition: Condition
  columns: ColumnInfo[]
  fks?: ForeignKey[]
  schema: string
  table: string
  otherConditions: Condition[]
  onChange: (next: Condition) => void
  onRemove: () => void
}) {
  const column = columns.find((c) => c.name === condition.column)
  const dataType = column?.dataType
  const ops = operatorsForType(dataType)
  const arity = arityForOp(condition.op)
  const warnings = warningsFor(condition)

  // The set picker used to be the first thing a column filter showed. It now
  // belongs to one operator, so every row carries the way back to it — nobody
  // should have to know that "is one of" is where the values live.
  const canPickValues = ops.includes('in')
  const picking = arity === 'many'

  const setValue = (index: number, value: string) => {
    const values = [...condition.values]
    while (values.length <= index) values.push('')
    values[index] = value
    onChange({ ...condition, values })
  }

  const pickColumn = (name: string) => {
    const nextType = columns.find((c) => c.name === name)?.dataType
    const nextOps = operatorsForType(nextType)
    // Keep the operator when the new column can take it, so retargeting a
    // condition does not silently change what it asks.
    const op = nextOps.includes(condition.op) ? condition.op : nextOps[0]
    onChange(changeOp({ ...condition, column: name }, op))
  }

  const selectClass =
    'rounded border border-[var(--line)] bg-[var(--surface-strong)] px-1.5 py-1 text-xs text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]'
  const inputClass =
    'min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 font-mono text-xs text-[var(--sea-ink)] outline-none placeholder:text-[var(--sea-ink-soft)]/50 focus:border-[var(--lagoon)]'

  return (
    <li className="rounded-lg border border-[var(--line)] px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <select
          value={condition.column}
          onChange={(e) => pickColumn(e.target.value)}
          aria-label="Column"
          className={`${selectClass} max-w-[9rem] flex-1 font-mono`}
        >
          {columns.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          value={condition.op}
          onChange={(e) => onChange(changeOp(condition, e.target.value as FilterOp))}
          aria-label="Operator"
          className={selectClass}
        >
          {ops.map((op) => (
            <option key={op} value={op}>
              {OP_LABELS[op]}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onRemove}
          title="Remove this condition"
          aria-label="Remove condition"
          className="ml-auto rounded px-1 text-sm text-[var(--sea-ink-soft)]/60 hover:text-[var(--lagoon-deep)]"
        >
          &times;
        </button>
      </div>

      {arity === 1 && (
        <input
          type="text"
          value={condition.values[0] ?? ''}
          onChange={(e) => setValue(0, e.target.value)}
          placeholder={dataType ?? 'value'}
          aria-label="Value"
          className={`${inputClass} mt-1.5 w-full`}
        />
      )}

      {arity === 2 && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            type="text"
            value={condition.values[0] ?? ''}
            onChange={(e) => setValue(0, e.target.value)}
            placeholder="from"
            aria-label="From"
            className={inputClass}
          />
          <span className="text-[10px] text-[var(--sea-ink-soft)]">up to</span>
          <input
            type="text"
            value={condition.values[1] ?? ''}
            onChange={(e) => setValue(1, e.target.value)}
            placeholder="before"
            aria-label="Before"
            className={inputClass}
          />
        </div>
      )}

      {canPickValues && (
        <button
          type="button"
          onClick={() => onChange(changeOp(condition, picking ? defaultOpForType(dataType) : 'in'))}
          className="mt-1 text-[10px] text-[var(--lagoon-deep)] hover:underline"
          title={
            picking
              ? 'Type a value instead of picking from the list'
              : 'Pick from the values this column actually holds'
          }
        >
          {picking ? 'Type a value instead' : 'Pick from values'}
        </button>
      )}

      {arity === 'many' && (
        <ValuePicker
          condition={condition}
          onChange={onChange}
          schema={schema}
          table={table}
          otherConditions={otherConditions}
          references={column?.references}
          fks={fks}
        />
      )}

      {warnings.map((warning) => (
        <p key={warning} className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
          {warning}
        </p>
      ))}
    </li>
  )
}
