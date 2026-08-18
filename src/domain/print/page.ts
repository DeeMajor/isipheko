/**
 * The page, in the units a printer works in.
 *
 * **A5 portrait with 3mm bleed.** A-series and millimetres are what the South
 * African trade uses, and A5 is the shape of a thing somebody keeps rather than
 * files. Everything here is arithmetic — no I/O, no PDF library, no framework
 * (CLAUDE.md rule 6) — so the geometry can be asserted without generating a
 * document.
 *
 * Three boxes, and the difference between them is the whole of why a print PDF
 * is not a screenshot:
 *
 *   **TrimBox** — where the guillotine comes down. The finished page.
 *   **BleedBox** — 3mm larger on every side. Ink that is meant to run off the
 *     edge must be painted out to here, because paper shifts under a blade and
 *     a background that stopped exactly at the trim leaves a white hairline.
 *   **MediaBox** — the sheet itself. Equal to the bleed box here: no crop marks
 *     are drawn, because a printer imposes their own and marks we drew would
 *     be a second set to reconcile.
 *
 * **RGB throughout, deliberately.** See docs/decisions.md M4-03 §4: SA trade
 * printers convert to their own profile, `--ink #16233D` is a specific navy
 * that a naive CMYK conversion would not honour, and body text built from four
 * plates registers badly at this size. The file says so in its metadata.
 */

/** PostScript points per millimetre. A point is 1/72 inch. */
const PT_PER_MM = 72 / 25.4

export function mm(value: number): number {
  return value * PT_PER_MM
}

export function toMm(points: number): number {
  return points / PT_PER_MM
}

/** A5, in millimetres. */
export const TRIM_WIDTH_MM = 148
export const TRIM_HEIGHT_MM = 210

/** Three millimetres on every side — the trade default, and what a shifted
 *  sheet forgives. */
export const BLEED_MM = 3

/**
 * The margin from the trim edge to anything that must survive the cut.
 *
 * Sixteen millimetres is generous for A5, and generous is right: this is a
 * record somebody reads slowly, and text crowding a cut edge reads as cheap.
 * The trade's usual safe zone is 5mm, so this clears it three times over.
 */
export const MARGIN_MM = 16

/** Extra room at the foot, where the folio sits under the text block. */
export const FOOT_MM = 10

export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The sheet, in points. Origin is bottom-left, as PDF has it. */
export const MEDIA: Box = {
  x: 0,
  y: 0,
  width: mm(TRIM_WIDTH_MM + BLEED_MM * 2),
  height: mm(TRIM_HEIGHT_MM + BLEED_MM * 2),
}

/** The finished page, inset from the sheet by the bleed. */
export const TRIM: Box = {
  x: mm(BLEED_MM),
  y: mm(BLEED_MM),
  width: mm(TRIM_WIDTH_MM),
  height: mm(TRIM_HEIGHT_MM),
}

/** Where content may go: the trim box less the margins and the folio strip. */
export const CONTENT: Box = {
  x: TRIM.x + mm(MARGIN_MM),
  y: TRIM.y + mm(MARGIN_MM) + mm(FOOT_MM),
  width: TRIM.width - mm(MARGIN_MM) * 2,
  height: TRIM.height - mm(MARGIN_MM) * 2 - mm(FOOT_MM),
}

/** Baseline for the folio, centred under the text block. */
export const FOLIO_Y = TRIM.y + mm(MARGIN_MM) * 0.6

/**
 * Whether a box keeps clear of the cut.
 *
 * The check a preflight makes and the reason the margin exists: content inside
 * this distance of the trim is content that may be cut through.
 */
export function isInsideSafeArea(box: Box, safeMm = 5): boolean {
  const safe = mm(safeMm)

  return (
    box.x >= TRIM.x + safe &&
    box.y >= TRIM.y + safe &&
    box.x + box.width <= TRIM.x + TRIM.width - safe &&
    box.y + box.height <= TRIM.y + TRIM.height - safe
  )
}

/**
 * The dots per inch an image would actually be printed at.
 *
 * `widthPx` is the stored photo's own width; `widthPt` is how wide it is placed
 * on the page. A print shop's floor is 300; below it, detail the eye can see on
 * a screen turns to mush on paper.
 */
export function effectiveDpi(widthPx: number, widthPt: number): number {
  if (widthPt <= 0) return 0

  return (widthPx / widthPt) * 72
}

/**
 * The largest box an image may be placed in and still hit 300dpi.
 *
 * **Shrinks the box; never upscales the image.** Enlarging pixels to fill a
 * frame is how a photograph of a grandmother becomes a soft rectangle, and the
 * frame is the thing nobody will miss.
 */
export function fitWithinDpi(
  photo: { width: number; height: number },
  box: { width: number; height: number },
  minimumDpi = 300,
): Box {
  const scale = Math.min(box.width / photo.width, box.height / photo.height)
  const capped = Math.min(scale, 72 / minimumDpi)

  // Clamped to the box after multiplying. `h * (boxH / h)` can land a fraction
  // of a nanopoint above `boxH` in floating point, and a frame that overflows
  // its box by any amount is a frame that overflows its box.
  return {
    x: 0,
    y: 0,
    width: Math.min(photo.width * capped, box.width),
    height: Math.min(photo.height * capped, box.height),
  }
}
