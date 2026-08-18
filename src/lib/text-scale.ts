/**
 * Page text size, as a per-browser preference.
 *
 * Applied as `zoom` on the root element rather than a root font size: the UI is
 * sized in pixels throughout, so a root `rem` change would move some of the page
 * and leave the rest behind. Zoom scales the type and the boxes around it
 * together, which is what "make it bigger" means to a reader.
 */

export const SCALE_STEPS = [0.9, 1, 1.1, 1.25, 1.4, 1.6] as const

export const DEFAULT_SCALE = 1
export const TEXT_SCALE_KEY = 'textScale'

/** The nearest step to whatever came out of storage, defaulting when unusable. */
export function parseScale(raw: string | null): number {
  // `Number(null)` and `Number('')` are both 0, which would snap to the
  // smallest step — absent has to mean default, not smallest.
  if (raw === null || raw.trim() === '') return DEFAULT_SCALE
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_SCALE
  return SCALE_STEPS.reduce((best, step) =>
    Math.abs(step - value) < Math.abs(best - value) ? step : best,
  )
}

/** One step up, or the same value when already at the top — the button disables. */
export function scaleUp(current: number): number {
  const index = SCALE_STEPS.indexOf(parseScale(String(current)) as (typeof SCALE_STEPS)[number])
  return SCALE_STEPS[Math.min(index + 1, SCALE_STEPS.length - 1)]
}

export function scaleDown(current: number): number {
  const index = SCALE_STEPS.indexOf(parseScale(String(current)) as (typeof SCALE_STEPS)[number])
  return SCALE_STEPS[Math.max(index - 1, 0)]
}

export function isLargest(current: number): boolean {
  return parseScale(String(current)) === SCALE_STEPS[SCALE_STEPS.length - 1]
}

export function isSmallest(current: number): boolean {
  return parseScale(String(current)) === SCALE_STEPS[0]
}

/** "100%", "125%" — the label on the reset button. */
export function scaleLabel(current: number): string {
  return `${Math.round(current * 100)}%`
}
