/**
 * Flowing a record onto fixed pages.
 *
 * The web album scrolls, so M4-02 never had to answer this. Paper does not:
 * something has to decide where one page stops and the next begins, and the
 * answer has to be the same every time the file is generated or two copies of
 * the same album are two different books.
 *
 * Pure — heights come in already measured, because measuring text needs a font
 * and a font is I/O. The adapter measures; this decides.
 */

export interface Measured<T> {
  readonly item: T
  /** Points, including everything the entry draws. */
  readonly height: number
}

export interface PaginateOptions {
  /** Usable height of a page, in points. */
  readonly usableHeight: number
  /** Space between entries. Never added after the last one on a page. */
  readonly gap: number
}

/**
 * Entries onto pages, in order, **one entry never split across two**.
 *
 * Splitting is the obvious thing and the wrong thing here. An entry is one
 * person: their name, what they brought, what they said and their photograph.
 * A break through the middle of that puts a stranger's name at the foot of one
 * page and their words on the next, which is exactly the indignity a record
 * like this exists to avoid.
 *
 * The cost is a ragged foot on some pages, which is what books have always
 * looked like. An entry too tall for any page still gets its own page rather
 * than overflowing — the renderer shrinks its photograph until it fits, which
 * is the one part of an entry that can give.
 */
export function paginate<T>(
  measured: readonly Measured<T>[],
  { usableHeight, gap }: PaginateOptions,
): readonly (readonly T[])[] {
  const pages: T[][] = []

  let page: T[] = []
  let used = 0

  for (const entry of measured) {
    const needed = page.length === 0 ? entry.height : entry.height + gap

    if (page.length > 0 && used + needed > usableHeight) {
      pages.push(page)
      page = []
      used = 0
    }

    page.push(entry.item)
    used += page.length === 1 ? entry.height : entry.height + gap
  }

  if (page.length > 0) pages.push(page)

  return pages
}

/**
 * Where each entry sits on its page, measured down from the top of the content
 * box.
 *
 * Returned as offsets rather than as PDF coordinates so the arithmetic can be
 * checked without knowing which way up the page counts.
 */
export function offsetsWithin<T>(
  page: readonly T[],
  heightOf: (item: T) => number,
  gap: number,
): readonly number[] {
  const offsets: number[] = []
  let cursor = 0

  for (const item of page) {
    offsets.push(cursor)
    cursor += heightOf(item) + gap
  }

  return offsets
}

/**
 * How many lines a string takes at a given width.
 *
 * Greedy by word, which is what a reader expects and what every book does. The
 * width of a run comes from the caller because it comes from a font.
 *
 * A word longer than the line is left alone rather than broken: hyphenation
 * needs a dictionary and a wrong break in a surname is worse than a line that
 * runs a little wide.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  widthOf: (run: string) => number,
): readonly string[] {
  const words = text.split(/\s+/).filter((word) => word !== '')
  if (words.length === 0) return []

  const lines: string[] = []
  let line = ''

  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`

    if (line !== '' && widthOf(candidate) > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }

  if (line !== '') lines.push(line)

  return lines
}
