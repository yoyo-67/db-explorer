import { Link } from '@tanstack/react-router'
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
          <Link
            to="/explorer/preview"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Preview
          </Link>
          <Link
            to="/explorer/documents"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Documents
          </Link>
        </div>

        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}
