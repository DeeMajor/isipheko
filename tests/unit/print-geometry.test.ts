import { describe, expect, it } from 'vitest'

import {
  BLEED_MM,
  CONTENT,
  MARGIN_MM,
  MEDIA,
  TRIM,
  TRIM_HEIGHT_MM,
  TRIM_WIDTH_MM,
  effectiveDpi,
  fitWithinDpi,
  isInsideSafeArea,
  mm,
  toMm,
} from '@/domain/print'

/**
 * The arithmetic a printer's preflight checks, checkable without a printer.
 *
 * These are the numbers that make a PDF a print file rather than a screenshot:
 * where the guillotine falls, how far past it the ink runs, and whether a
 * photograph has enough pixels to survive being put on paper.
 */

describe('millimetres and points', () => {
  it('converts at 72 points to the inch', () => {
    expect(mm(25.4)).toBeCloseTo(72, 6)
    expect(toMm(72)).toBeCloseTo(25.4, 6)
    expect(toMm(mm(148))).toBeCloseTo(148, 9)
  })
})

describe('the three boxes', () => {
  it('trims to A5', () => {
    expect(toMm(TRIM.width)).toBeCloseTo(TRIM_WIDTH_MM, 6)
    expect(toMm(TRIM.height)).toBeCloseTo(TRIM_HEIGHT_MM, 6)
    expect(TRIM_WIDTH_MM).toBe(148)
    expect(TRIM_HEIGHT_MM).toBe(210)
  })

  /**
   * The whole reason a bleed box exists. Paper shifts under a blade, and a
   * background that stopped exactly at the trim leaves a white hairline down
   * one edge of some copies and not others.
   */
  it('bleeds 3mm on every side', () => {
    expect(toMm(MEDIA.width - TRIM.width)).toBeCloseTo(BLEED_MM * 2, 6)
    expect(toMm(MEDIA.height - TRIM.height)).toBeCloseTo(BLEED_MM * 2, 6)
    expect(toMm(TRIM.x)).toBeCloseTo(BLEED_MM, 6)
    expect(toMm(TRIM.y)).toBeCloseTo(BLEED_MM, 6)
  })

  it('keeps content well inside the cut', () => {
    expect(isInsideSafeArea(CONTENT)).toBe(true)

    // The trade's usual safe zone is 5mm and the margin clears it three times
    // over, because this is a record somebody reads slowly and text crowding a
    // cut edge reads as cheap.
    expect(MARGIN_MM).toBeGreaterThanOrEqual(15)
  })

  it('knows when something is too close to the blade', () => {
    expect(isInsideSafeArea({ x: TRIM.x, y: TRIM.y, width: 10, height: 10 })).toBe(false)
    expect(
      isInsideSafeArea({ x: 0, y: 0, width: MEDIA.width, height: MEDIA.height }),
    ).toBe(false)
  })
})

describe('photographs on paper', () => {
  it('computes the resolution a picture will actually print at', () => {
    // 300dpi is the trade floor: below it, detail the eye reads on a screen
    // turns to mush on paper.
    expect(effectiveDpi(1200, mm(101.6))).toBeCloseTo(300, 1)
    expect(effectiveDpi(0, 100)).toBe(0)
    expect(effectiveDpi(1000, 0)).toBe(0)
  })

  it('fits a large photo to the box and stays above 300dpi', () => {
    const box = { width: mm(116), height: mm(120) }
    const fitted = fitWithinDpi({ width: 2400, height: 1600 }, box)

    expect(fitted.width).toBeLessThanOrEqual(box.width)
    expect(fitted.height).toBeLessThanOrEqual(box.height)
    expect(effectiveDpi(2400, fitted.width)).toBeGreaterThanOrEqual(300)
  })

  /**
   * **Shrinks the frame; never enlarges the picture.**
   *
   * Upscaling to fill a box is how a photograph of a grandmother becomes a soft
   * rectangle. The frame is the part nobody will miss.
   */
  it('never upscales a small photo to fill the frame', () => {
    const box = { width: mm(116), height: mm(120) }
    const fitted = fitWithinDpi({ width: 400, height: 300 }, box)

    expect(fitted.width).toBeLessThan(box.width)
    expect(effectiveDpi(400, fitted.width)).toBeCloseTo(300, 0)
  })

  it('keeps the shape of the photograph', () => {
    const fitted = fitWithinDpi(
      { width: 1600, height: 2400 },
      {
        width: mm(116),
        height: mm(90),
      },
    )

    expect(fitted.width / fitted.height).toBeCloseTo(1600 / 2400, 6)
    expect(fitted.height).toBeLessThanOrEqual(mm(90))
  })
})
