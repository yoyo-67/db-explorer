/**
 * One vocabulary of severity for every new panel, so a colour means the same
 * thing on the byte ruler as it does on a replication slot.
 */
export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'muted'

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-[var(--sea-ink)]',
  good: 'text-[var(--palm)]',
  warn: 'text-[#8a5a00] dark:text-[#e9c46a]',
  bad: 'text-red-700 dark:text-red-300',
  muted: 'text-[var(--sea-ink-soft)]',
}

export const TONE_FILL: Record<Tone, string> = {
  neutral: 'bg-[var(--lagoon)]',
  good: 'bg-[var(--palm)]',
  warn: 'bg-[#d69e2e]',
  bad: 'bg-red-500',
  muted: 'bg-[rgba(23,58,64,0.25)] dark:bg-[rgba(215,236,232,0.25)]',
}

export const TONE_SOFT: Record<Tone, string> = {
  neutral: 'bg-[rgba(79,184,178,0.14)]',
  good: 'bg-[rgba(47,106,74,0.14)]',
  warn: 'bg-[rgba(214,158,46,0.18)]',
  bad: 'bg-red-100 dark:bg-red-950',
  muted: 'bg-[rgba(23,58,64,0.06)] dark:bg-[rgba(215,236,232,0.06)]',
}
