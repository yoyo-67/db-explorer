import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import ServerProfileView from '#/components/server/ServerProfileView'
import ServerNowView from '#/components/server/ServerNowView'
import { SERVER_FACES, SERVER_FACE_HINTS, SERVER_FACE_LABELS } from '#/lib/server-face'
import type { ServerFace } from '#/lib/server-face'

/**
 * The server, within reach of whatever page is open.
 *
 * Configuration is ambient context, not a destination: nobody navigates to
 * `work_mem`, they want it while reading a plan that spilled to disk. So it
 * lives in a sheet the header can open over any page, next to the other half of
 * the same question — what the server is doing right now.
 *
 * The two faces are deliberately separate. One is true until somebody restarts
 * the server; the other is false a second after it is read, and only that one
 * polls.
 *
 * Which face is open lives in the URL (`?server=now`), because a server that is
 * misconfigured or is blocking itself is a finding, and a finding is worth
 * sending to someone. Rendered through a portal on `document.body`, which is not
 * decoration: the header carries a `backdrop-filter`, and a filtered element
 * becomes the containing block for `position: fixed` inside it — a sheet
 * rendered where its button lives is clipped to the height of the header.
 */
export default function ServerSheet({
  face,
  onFaceChange,
  onClose,
}: {
  /** `undefined` means the sheet is shut. */
  face: ServerFace | undefined
  onFaceChange: (face: ServerFace) => void
  onClose: () => void
}) {
  useEffect(() => {
    if (!face) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [face, onClose])

  if (!face || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        aria-label="Close server panel"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/20 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Server"
        className="absolute inset-y-0 right-0 flex w-full max-w-[30rem] flex-col border-l border-[var(--line)] bg-[var(--surface-strong)] shadow-2xl backdrop-blur-xl"
      >
        <header className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-2">
          <span className="island-kicker">Server</span>
          <div role="tablist" aria-label="Server views" className="flex gap-1">
            {SERVER_FACES.map((candidate) => {
              const active = candidate === face
              return (
                <button
                  key={candidate}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={SERVER_FACE_HINTS[candidate]}
                  onClick={() => onFaceChange(candidate)}
                  className={`rounded border px-2 py-0.5 text-xs transition ${
                    active
                      ? 'border-[var(--lagoon)] bg-[rgba(79,184,178,0.16)] font-medium text-[var(--lagoon-deep)]'
                      : 'border-[var(--line)] text-[var(--sea-ink-soft)] hover:border-[var(--lagoon)] hover:text-[var(--lagoon-deep)]'
                  }`}
                >
                  {SERVER_FACE_LABELS[candidate]}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--sea-ink-soft)] hover:text-[var(--lagoon-deep)]"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {face === 'profile' ? <ServerProfileView /> : <ServerNowView open />}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
