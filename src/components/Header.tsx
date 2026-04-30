import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { $getSchemas, $getTables } from '#/server/api'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)]/60 bg-[var(--header-bg)] px-4 backdrop-blur-lg">
      <nav className="page-wrap flex items-center gap-x-3 py-2">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--sea-ink)] no-underline"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--lagoon)]" />
          DB Explorer
        </Link>

        <div className="flex items-center gap-x-3 text-xs font-medium">
          <Link
            to="/"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
            activeOptions={{ exact: true }}
          >
            Connect
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <SchemaPicker />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}

function SchemaPicker() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isOnTableRoute = pathname.startsWith('/t/')
  const currentSchema = isOnTableRoute ? pathname.split('/')[2] : undefined

  const schemasQuery = useQuery({
    queryKey: ['schemas'],
    queryFn: () => $getSchemas(),
    staleTime: Infinity,
  })

  const schemas = schemasQuery.data ?? []
  if (schemas.length === 0) return null

  const selected = currentSchema ?? schemas[0]

  const handleChange = async (nextSchema: string) => {
    const tables = await $getTables({ data: { schema: nextSchema } })
    if (tables.length === 0) return
    navigate({
      to: '/t/$schema/$table',
      params: { schema: nextSchema, table: tables[0].name },
    })
  }

  return (
    <select
      value={selected}
      onChange={(e) => handleChange(e.target.value)}
      className="rounded-lg border border-[var(--line)] bg-[var(--surface-strong)] px-2 py-1 text-xs text-[var(--sea-ink)] outline-none"
      title="Schema"
    >
      {schemas.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}
