import { useRef } from 'react'
import DdlTab from '#/components/inspect/DdlTab'
import PhysicalTab from '#/components/inspect/PhysicalTab'
import ProfileTab from '#/components/inspect/ProfileTab'
import {
  INSPECTOR_TAB_HINTS,
  INSPECTOR_TAB_LABELS,
  nextInspectorTab,
  visibleInspectorTabs,
} from '#/lib/inspect/tabs'
import { useAppSettings } from '#/hooks/useAppSettings'
import { setSetting } from '#/hooks/useAppSettings'
import type { InspectorTab } from '#/lib/inspect/tabs'
import type { Condition } from '#/lib/filter-model'

/**
 * The table's own definition, above its rows: what the planner knows about each
 * column, the DDL, and — behind the advanced switch — the physical shape of a
 * row.
 *
 * Which tab is open lives in the URL, so a link to a finding opens on it. Each
 * tab fetches only while it is the open one — nothing is paid for a panel that
 * is closed, and the rows below stay where they were.
 */
export default function TableInspector({
  schema,
  table,
  tab,
  onTabChange,
  conditions,
  onToggleCondition,
}: {
  schema: string
  table: string
  /** `undefined` means the panel is collapsed. */
  tab: InspectorTab | undefined
  onTabChange: (tab: InspectorTab | undefined) => void
  /** The filter the rows below are under, so a chip can show as pressed. */
  conditions: Condition[]
  onToggleCondition: (condition: Condition) => void
}) {
  const tabRefs = useRef<Partial<Record<InspectorTab, HTMLButtonElement | null>>>({})
  const { advancedInspector } = useAppSettings()
  // An advanced tab that is already open stays on screen whatever the
  // preference says, so a link to one does not land on an empty panel.
  const tabs = visibleInspectorTabs(advancedInspector, tab)

  const move = (from: InspectorTab, delta: number) => {
    const next = nextInspectorTab(from, delta, tabs)
    onTabChange(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <section className="island-shell rounded-xl">
      <div
        role="tablist"
        aria-label="Table inspector"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5"
        onKeyDown={(event) => {
          if (!tab) return
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            move(tab, 1)
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault()
            move(tab, -1)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onTabChange(undefined)
          }
        }}
      >
        <span className="island-kicker mr-1">Inspect</span>
        {tabs.map((candidate) => {
          const active = candidate === tab
          return (
            <button
              key={candidate}
              ref={(node) => {
                tabRefs.current[candidate] = node
              }}
              type="button"
              role="tab"
              id={`inspector-tab-${candidate}`}
              aria-selected={active}
              aria-controls={`inspector-panel-${candidate}`}
              tabIndex={active || (!tab && candidate === tabs[0]) ? 0 : -1}
              onClick={() => onTabChange(active ? undefined : candidate)}
              title={
                active
                  ? `Hide ${INSPECTOR_TAB_LABELS[candidate]}`
                  : INSPECTOR_TAB_HINTS[candidate]
              }
              className={`rounded border px-2 py-0.5 text-xs transition ${
                active
                  ? 'border-[var(--lagoon)] bg-[rgba(79,184,178,0.16)] font-medium text-[var(--lagoon-deep)]'
                  : 'border-[var(--line)] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]'
              }`}
            >
              {INSPECTOR_TAB_LABELS[candidate]}
            </button>
          )
        })}
        {tab ? (
          <>
            <span className="hidden text-[11px] text-[var(--sea-ink-soft)] sm:inline">
              {INSPECTOR_TAB_HINTS[tab]}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <AdvancedToggle advanced={advancedInspector} />
              <button
                type="button"
                onClick={() => onTabChange(undefined)}
                className="rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--sea-ink-soft)] hover:text-[var(--lagoon-deep)]"
              >
                Hide
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="text-[11px] text-[var(--sea-ink-soft)]">
              statistics and definition — read from the catalog, not from the rows
            </span>
            <div className="ml-auto">
              <AdvancedToggle advanced={advancedInspector} />
            </div>
          </>
        )}
      </div>

      {/* min-w-0 so a wide child — the profile's non-wrapping table — scrolls
          inside its own container instead of stretching the page. */}
      {tab && (
        <div
          role="tabpanel"
          id={`inspector-panel-${tab}`}
          aria-labelledby={`inspector-tab-${tab}`}
          className="min-w-0 border-t border-[var(--line)] px-3 py-3"
        >
          {tab === 'profile' && (
            <ProfileTab
              schema={schema}
              table={table}
              conditions={conditions}
              onToggleCondition={onToggleCondition}
            />
          )}
          {tab === 'physical' && <PhysicalTab schema={schema} table={table} />}
          {tab === 'ddl' && (
            <DdlTab
              schema={schema}
              table={table}
              conditions={conditions}
              onToggleCondition={onToggleCondition}
            />
          )}
        </div>
      )}
    </section>
  )
}

/**
 * The switch that reveals the advanced tabs, remembered per browser.
 *
 * Kept next to the tabs rather than on the settings page: it is the tabs it is
 * about, and a preference nobody can find where it applies is a preference
 * nobody turns on.
 */
function AdvancedToggle({ advanced }: { advanced: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={advanced}
      onClick={() => setSetting('advancedInspector', !advanced)}
      title={
        advanced
          ? 'Hide the advanced tabs'
          : `Show the advanced tabs — ${INSPECTOR_TAB_HINTS.physical}`
      }
      className={`rounded border px-2 py-0.5 text-xs transition ${
        advanced
          ? 'border-[var(--lagoon)] bg-[rgba(79,184,178,0.16)] text-[var(--lagoon-deep)]'
          : 'border-[var(--line)] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]'
      }`}
    >
      Advanced
    </button>
  )
}
