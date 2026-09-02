import { useNavigate, useRouterState } from '@tanstack/react-router'
import ServerSheet from '#/components/server/ServerSheet'
import { parseServerFace } from '#/lib/server-face'
import type { ServerFace } from '#/lib/server-face'

/**
 * The header's way in, and the one place the panel's URL state is written.
 *
 * The face is read from the location rather than from the root route's typed
 * search: this button renders in the header, above every route, and reading a
 * route's search from there would tie the header to whichever page is open.
 */
export default function ServerSheetButton() {
  const navigate = useNavigate()
  const face = useRouterState({
    select: (state) => parseServerFace(state.location.search.server),
  })

  const setFace = (next: ServerFace | undefined) => {
    navigate({
      to: '.',
      search: (old: Record<string, unknown>) => ({ ...old, server: next }),
      // The panel is a view of the page, not a page: closing it should not cost
      // a press of the back button, and opening it should not bury the history
      // entry that got the reader here.
      replace: true,
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setFace(face ? undefined : 'profile')}
        aria-expanded={face !== undefined}
        title="Server — configuration, extensions, and what it is doing right now"
        className={`cursor-pointer rounded-lg border px-2 py-1 text-xs leading-none transition ${
          face
            ? 'border-[var(--lagoon)]/60 bg-[rgba(79,184,178,0.12)] text-[var(--sea-ink)]'
            : 'border-[var(--line)] bg-[var(--surface-strong)] text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'
        }`}
      >
        Server
      </button>
      <ServerSheet
        face={face}
        onFaceChange={(next) => setFace(next)}
        onClose={() => setFace(undefined)}
      />
    </>
  )
}
