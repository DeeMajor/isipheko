import type { ArchetypeKey } from '@/domain/archetype'

/**
 * The album — every message, photo and contribution as one page.
 *
 * **Almost all of its words are borrowed, deliberately.** The heading over the
 * entries is `archetypeEventCopy[…].strandHeading`, a quiet giver is
 * `eventCopy.strand.quietly`, an empty album is `eventCopy.strand.empty`, and
 * what somebody did is the strand's own phrasing. The album is the strand's
 * record written out at length, and a second set of strings for the same ideas
 * is how the two start saying different things about one event.
 *
 * What is here is what only the album says.
 *
 * Two rules this file is written against:
 *
 *   **No count, no total, no amount, at any archetype.** Not in a heading, not
 *   in a footer, not as "400 people". The strand's size bands are unlabelled so
 *   that amounts cannot be reverse-engineered (Part C.4), and this is the
 *   artefact that gets printed and passed around.
 *
 *   **It reads at a funeral.** There is one shared shell for every archetype
 *   and nothing celebratory in it. What changes is the accent, which is a CSS
 *   fallback, and the one archetype-keyed line below.
 */

/**
 * The one sentence that has to change with the archetype.
 *
 * *"brought"* and *"said"* are right everywhere. What differs is whether the
 * page is describing a day people came to celebrate or a day they came to sit
 * with somebody, and a single neutral line for both would be a line written for
 * neither.
 */
export const archetypeAlbumIntro: Record<ArchetypeKey, string> = {
  umshado:
    'Everything that was brought and everything that was said, in the order it came.',
  umembeso:
    'Everything that was brought and everything that was said, in the order it came.',
  umngcwabo: 'Everyone who stood with the family, in the order they came.',
  umbuyiso: 'Everyone who stood with the family, in the order they came.',
  imbeleko:
    'Everything that was brought and everything that was said, in the order it came.',
  graduation:
    'Everything that was brought and everything that was said, in the order it came.',
  itiye:
    'Everything that was brought and everything that was said, in the order it came.',
}

export const albumCopy = {
  /** The browser tab and nothing else. Not a heading — the event's name is. */
  documentSuffix: 'the record',

  /**
   * The link on the event page.
   *
   * Not *"View album"* — that is product vocabulary for a thing the product
   * invented. This is the record, and calling it that works on a funeral page
   * where the word *album* would not.
   */
  link: 'The whole record',

  /** Above the strand. The strand is the cover, so it introduces itself. */
  coverLabel: 'The record',

  /**
   * A photo's alternative text.
   *
   * Nobody describes their photo when they attach it, so there is nothing
   * honest to put here except where it came from. Empty alt would be wrong: the
   * picture is content, not decoration — it is half of what somebody left.
   */
  photoFrom: (name: string) => `A photo from ${name}`,

  /**
   * What the page is, at the foot of it.
   *
   * States the two things somebody reading it later needs to know: that it is
   * the same record the chain holds, and that it holds only what was confirmed.
   * No totals, and nothing about how much.
   */
  foot: 'This is the record as the family confirmed it. Nothing here can be edited — a correction is written as its own line.',

  /**
   * The printed album (M4-03).
   *
   * Two audiences read this copy and they need different things. The organiser
   * needs to know **when** — there is no queue daemon, so a render waits for
   * the next scheduled run, and a spinner that means nothing is a lie with a
   * moving part. The printer needs to know **what they are opening**, chiefly
   * that it is RGB.
   */
  print: {
    heading: 'A printed copy',
    body: 'A print-ready PDF of the whole record — A5, with the bleed and margins a printer needs. Take it to any print shop.',

    request: 'Make a printable copy',
    /**
     * Said before the wait rather than discovered during it. **If the schedule
     * changes, this sentence changes with it** — see docs/decisions.md M4-03
     * §10.
     */
    queued:
      'Being put together now. It is made by a job that runs every hour, so it will usually be ready within the hour — you do not need to keep this page open.',
    rendering: 'Being put together now.',
    ready: 'Download the printable album',
    /** Says what to do, not only what went wrong. */
    failed:
      'That did not come together. Press the button again — if it fails a second time, the record itself is still safe and nothing has been lost from it.',
    /** Under the download, so somebody printing it knows before the counter. */
    readyNote: 'A5, 3mm bleed, RGB. Most print shops will convert the colour themselves.',
    /** Offered only once there is something to print. */
    empty: 'There is nothing to print yet.',
  },
} as const

/**
 * The colophon: the last page of the printed album.
 *
 * It exists for the person at the press. A colour space discovered at the
 * counter is a colour space discovered too late, so **RGB is stated in words**
 * as well as in the file's metadata, and the trim and bleed are named in
 * millimetres.
 *
 * The last line is for whoever holds the book in ten years, which is the
 * audience the whole artefact is for.
 */
export const albumColophon = (when: string): readonly string[] => [
  'This book is the record of an umcimbi, printed from Isipheko.',
  'A5, 148 × 210mm trimmed, 3mm bleed on every edge. Colours are RGB — most print shops will convert to their own profile, which is the intention.',
  'Every page here was written by somebody who stood with this family. Nothing in it can be edited: a correction is added as its own line, never rubbed out.',
  `Printed from the record as it stood on ${when}.`,
]
