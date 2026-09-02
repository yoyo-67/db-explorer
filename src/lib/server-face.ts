/**
 * Which face of the server panel is open, as it travels in the URL.
 *
 * Two faces, and "closed" is the absence of the key rather than a third value —
 * so a link that says nothing about the panel opens the page without it, and
 * every other link carries what the sender was looking at.
 */
export const SERVER_FACES = ['profile', 'now'] as const

export type ServerFace = (typeof SERVER_FACES)[number]

/** Search params are untrusted input: anything else means the panel is shut. */
export function parseServerFace(value: unknown): ServerFace | undefined {
  return typeof value === 'string' && (SERVER_FACES as readonly string[]).includes(value)
    ? (value as ServerFace)
    : undefined
}

export const SERVER_FACE_LABELS: Record<ServerFace, string> = {
  profile: 'Profile',
  now: 'Now',
}

export const SERVER_FACE_HINTS: Record<ServerFace, string> = {
  profile: 'what this server was tuned to be',
  now: 'what it is doing at this instant',
}
