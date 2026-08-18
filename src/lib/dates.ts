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
 * `formatEventDate` in `src/lib/event-card.ts` stays separate: it carries the
 * weekday, because *"Saturday, 15 August"* is how somebody decides whether they
 * can be there, and that is a different question from when a check was run.
 */
export function formatDayMonth(date: Date | null): string | null {
  if (date === null) return null

  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(date)
}
