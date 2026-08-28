import { createFileRoute } from '@tanstack/react-router'
import DatabaseAdmin from '#/components/DatabaseAdmin'
import { setSetting, useAppSettings } from '#/hooks/useAppSettings'
import { STATEMENT_TIMEOUT_CHOICES } from '#/lib/app-settings'
import type { TableNameDisplay } from '#/lib/table-label'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

/**
 * What each mode does to a row, said with a row rather than about one.
 *
 * A made-up pair rather than a table out of whatever schema is connected: the
 * setting outlives any one connection, and an example that named a real table
 * would read as a claim about that table.
 */
const EXAMPLE_TABLE = 'shop_orderline'
const EXAMPLE_MODEL = 'OrderLineItem'

const TABLE_NAME_CHOICES: Array<{ value: TableNameDisplay; label: string }> = [
  { value: 'table-then-model', label: `${EXAMPLE_TABLE} (${EXAMPLE_MODEL})` },
  { value: 'model-then-table', label: `${EXAMPLE_MODEL} (${EXAMPLE_TABLE})` },
  { value: 'table', label: EXAMPLE_TABLE },
  { value: 'model', label: EXAMPLE_MODEL },
]

/**
 * Every knob this app has, on one page.
 *
 * One title, then bands: a page that repeated a serif hero over each group made
 * three settings look like three products. The rows are a divided list rather
 * than a stack of cards, because that is what a settings page is — a list of
 * statements, each with the control that changes it on the right.
 */
function SettingsPage() {
  const settings = useAppSettings()

  return (
    <main className="page-wrap px-4 pb-16 pt-14">
      <header className="mb-8 max-w-2xl">
        <p className="island-kicker mb-3">Settings</p>
        <h1 className="display-title mb-4 text-3xl leading-[1.08] font-bold tracking-tight text-[var(--sea-ink)] sm:text-4xl">
          This browser
        </h1>
        <p className="text-base text-[var(--sea-ink-soft)]">
          Kept in this browser and shared by every tab. Two of these are sent on
          to the server, which is the only place a query log or a timeout can
          actually be enforced.
        </p>
      </header>

      <div className="island-shell rise-in overflow-hidden rounded-[1.75rem]">
        <Section
          title="Reading"
          blurb="How the app prints what it finds."
        >
          <Row
            label="Table names"
            hint="Every list, header and row link prints a table this way. Search is unaffected — it answers to the raw name and the model whichever one is on screen — so a table can never hide behind the name you did not pick."
          >
            <Select
              label="Table names"
              value={settings.tableNameDisplay}
              options={TABLE_NAME_CHOICES}
              onChange={(next) => setSetting('tableNameDisplay', next)}
            />
          </Row>
        </Section>

        <Section
          title="Instrumentation"
          blurb="What the app measures, and how long it is allowed to wait."
        >
          <Row
            label="Query stats HUD"
            hint="Shows the ⚡ counter in the header. While on, the server logs every query it runs and each open tab polls that log once a second."
          >
            <Switch
              label="Query stats HUD"
              checked={settings.queryHud}
              onChange={(next) => setSetting('queryHud', next)}
            />
          </Row>

          <Row
            label="Query timeout"
            hint="Every query runs under this statement_timeout. A query that reaches it is cancelled and the page says so, which is the point: a scan nobody is waiting for should give the connection back."
          >
            <Select
              label="Query timeout"
              value={settings.statementTimeoutMs}
              options={STATEMENT_TIMEOUT_CHOICES.map((ms) => ({
                value: ms,
                label: ms < 60_000 ? `${ms / 1000} seconds` : `${ms / 60_000} minutes`,
              }))}
              onChange={(next) => setSetting('statementTimeoutMs', next)}
            />
          </Row>
        </Section>

        {/* Not a browser setting at all: these three change the server, and the
            last of them cannot be undone. Filed here because each is reached for
            once — the header carries what a session navigates with. */}
        <Section
          title="Databases on this server"
          blurb="Rename a database, say which database's private metadata a restored copy should read, or drop one. A rename follows through: the metadata folder under local/ moves with it and presets.json catches up. A drop deletes the database and every row in it, and leaves the metadata folder behind."
          accent
        >
          <DatabaseAdmin />
        </Section>

        {/* The one switch that lets the app write, so it is marked rather than
            filed: an accent rail and a paragraph of its own, at the bottom. */}
        <Section
          title="Writing"
          blurb="Everything above reads. This is the only switch that lets the app write, and it starts off. It changes what you can reach, not what the server will accept: an update is still one row, still keyed on the primary key, still shown to you as SQL before it runs, and still refused if the row moved since the page read it."
          accent
        >
          <Row
            label="Edit mode"
            hint="An expanded row grows an Edit button. Tables only — a view has no rows of its own — and only where a primary key identifies the row."
          >
            <Switch
              label="Edit mode"
              checked={settings.editMode}
              onChange={(next) => setSetting('editMode', next)}
            />
          </Row>
        </Section>
      </div>
    </main>
  )
}

/**
 * A band of related settings: a small heading, a sentence, then the rows.
 *
 * `accent` marks the band whose consequences leave the browser — a rail rather
 * than a colour on the text, so it reads as a margin note and not a warning
 * anyone has to dismiss.
 */
function Section({
  title,
  blurb,
  accent = false,
  children,
}: {
  title: string
  blurb: string
  accent?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className={`border-t border-[var(--line)] px-6 py-7 first:border-t-0 sm:px-9 ${
        accent ? 'border-l-2 border-l-[var(--lagoon)]' : ''
      }`}
    >
      <h2 className="text-sm font-semibold tracking-tight text-[var(--sea-ink)]">{title}</h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--sea-ink-soft)]">
        {blurb}
      </p>
      <div className="mt-5 divide-y divide-[var(--line)]/70">{children}</div>
    </section>
  )
}

/** One setting: what it is on the left, the control that changes it on the right. */
function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 py-4 first:pt-0 last:pb-0">
      <div className="min-w-[14rem] flex-1">
        <p className="text-sm font-medium text-[var(--sea-ink)]">{label}</p>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-[var(--sea-ink-soft)]">
          {hint}
        </p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  )
}

function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  /** Named for the screen reader: the visible label is a paragraph, not a `label`. */
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (next: T) => void
}) {
  return (
    <select
      aria-label={label}
      value={value}
      // Back through the option list rather than parsed out of the event: the DOM
      // only ever hands back a string, and half these choices are numbers.
      onChange={(e) => {
        const picked = options.find((o) => String(o.value) === e.target.value)
        if (picked) onChange(picked.value)
      }}
      className="min-w-[13rem] rounded-lg border border-[var(--line)] bg-[var(--bg-base)] px-2.5 py-1.5 text-sm text-[var(--sea-ink)] outline-none focus:border-[var(--lagoon)]"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/**
 * A checkbox drawn as a track and a knob. Still a checkbox underneath — the
 * label wraps it, so a click anywhere on the switch and a space keypress both
 * land, and a screen reader hears a checkbox rather than a styled div.
 */
function Switch({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={`relative h-5 w-9 rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--lagoon)] ${
          checked
            ? 'border-[var(--lagoon-deep)] bg-[var(--lagoon)]'
            : 'border-[var(--line)] bg-[var(--surface)]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-[var(--bg-base)] shadow transition-[left] ${
            checked ? 'left-[1.15rem]' : 'left-0.5'
          }`}
        />
      </span>
      <span className="text-xs text-[var(--sea-ink-soft)]">{checked ? 'On' : 'Off'}</span>
    </label>
  )
}
