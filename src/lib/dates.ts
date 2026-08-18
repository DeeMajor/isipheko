/**
 * The one way a date is written on a public page.
 *
 * `12 August`, en-ZA, in UTC — the day the thing happened, not the server's
 * idea of today. Both public pages now render a verification date and there is
 * no version of this product where the collection page and the event page
 * should format one differently, so it is one function rather than a copy in
 * each. The collection page had the only copy of it until M3-02 added the
 * second caller.
 *
 * {@link formatEventDate} is the third, and carries the weekday: *"Saturday,
 * 15 August"* is how somebody decides whether they can be there, which is a
 * different question from when a check was run. It lived in
 * `src/lib/event-card.ts` until M4-03, when `pnpm render` needed it — and that
 * module value-imports `@/domain/share`, which plain Node cannot resolve
 * (docs/decisions.md M2-01 §8). This file imports nothing at all, which is what
 * makes it loadable from a scheduled job.
 */
export function formatDayMonth(date: Date | null): string | null {
  if (date === null) return null

  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date)
}

/**
 * `12 August 2026` — the same day, written to last.
 *
 * The year is the difference. `formatDayMonth` drops it because a verification
 * date is read now, against a page somebody is deciding about today. A record
 * is read later: the incwadi is the sheet a family keeps, and the album (M4-02)
 * is what the record looks like in five years. A date without a year is fine
 * until it is the only date on the paper.
 *
 * The incwadi held a private copy of this until the album needed the same
 * thing. Two formatters for one idea across two artefacts is how they drift.
 */
export function formatDayMonthYear(date: Date | null): string | null {
  if (date === null) return null

  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/**
 * `Saturday, 15 August` — the day of the umcimbi, with the weekday.
 *
 * The weekday is the point: somebody reading a link preview is deciding whether
 * they can be there, and "the fifteenth" answers that question far more slowly
 * than "Saturday".
 *
 * No year, deliberately. An event date is read before the day, not after it.
 */
export function formatEventDate(date: Date | null): string | null {
  if (date === null) return null

  return new Intl.DateTimeFormat('en-ZA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date)
}
