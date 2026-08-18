import { describe, expect, it } from 'vitest'

import { ARCHETYPES } from '@/domain/archetype'
import { fromCents } from '@/domain/money'
import {
  BAND_DIAMETERS,
  CORD_PITCH,
  DENSITY,
  UNIFORM_BAND,
  bandFor,
  beadDiameter,
  daysBetween,
  densityFor,
  positionFor,
  rowsFor,
  strandHeight,
} from '@/domain/strand'

const rand = (rands: number) => fromCents(BigInt(rands) * 100n)

describe('the density table', () => {
  it('is Part C.4 exactly, and is not a starting point', () => {
    expect(DENSITY.map((band) => [band.max, band.cords, band.pitch, band.scale])).toEqual(
      [
        [30, 1, 46, 1],
        [80, 2, 40, 0.92],
        [200, 3, 30, 0.78],
        [Number.POSITIVE_INFINITY, 5, 18, 0.58],
      ],
    )
  })

  it('picks the band by the count, on the boundary and either side of it', () => {
    expect(densityFor(1).cords).toBe(1)
    expect(densityFor(30).cords).toBe(1)
    expect(densityFor(31).cords).toBe(2)
    expect(densityFor(80).cords).toBe(2)
    expect(densityFor(81).cords).toBe(3)
    expect(densityFor(200).cords).toBe(3)
    expect(densityFor(201).cords).toBe(5)
    expect(densityFor(400).cords).toBe(5)
  })

  it('does not fall off the end for an absurd number of contributions', () => {
    expect(densityFor(1_000_000).cords).toBe(5)
  })
})

describe('bands', () => {
  const wedding = ARCHETYPES.umshado
  const funeral = ARCHETYPES.umngcwabo

  it('sorts cash into four coarse sizes where amounts are public', () => {
    const band = (amount: number) =>
      bandFor({
        form: 'cash',
        amount: rand(amount),
        amountsPublic: wedding.amountsPublic,
      })

    expect(band(50)).toBe(0)
    expect(band(99)).toBe(0)
    expect(band(100)).toBe(1)
    expect(band(499)).toBe(1)
    expect(band(500)).toBe(2)
    expect(band(1_999)).toBe(2)
    expect(band(2_000)).toBe(3)
    expect(band(50_000)).toBe(3)
  })

  it('renders one diameter for everything where amounts are hidden', () => {
    // Four monotonic sizes leak a coarse amount to anybody who compares two
    // beads, and comparing what people gave is exactly what a bereavement
    // event's hidden amounts exist to prevent (architecture §7.3).
    expect(funeral.amountsPublic).toBe(false)

    const bands = [1, 100, 900, 40_000].map((amount) =>
      bandFor({
        form: 'cash',
        amount: rand(amount),
        amountsPublic: funeral.amountsPublic,
      }),
    )

    expect(new Set(bands)).toEqual(new Set([UNIFORM_BAND]))
  })

  it('drives this off amountsPublic, so no archetype is named anywhere', () => {
    // The rule reads the same flag that sets the visibility default, so the
    // two cannot disagree — and nothing here asks whether it is a funeral.
    const configs = Object.values(ARCHETYPES)

    for (const config of configs) {
      const band = bandFor({
        form: 'cash',
        amount: rand(5_000),
        amountsPublic: config.amountsPublic,
      })

      expect(band).toBe(config.amountsPublic ? 3 : UNIFORM_BAND)
    }
  })

  it('gives in-kind the middle diameter, never the smallest', () => {
    const kind = bandFor({ form: 'in_kind', amount: null, amountsPublic: true })

    expect(kind).toBe(UNIFORM_BAND)
    expect(BAND_DIAMETERS[kind]).toBe(14)
    // Equal mass with cash of the same band: the forms differ by shape only.
    expect(BAND_DIAMETERS[kind]).toBeGreaterThan(BAND_DIAMETERS[0])
  })

  it('scales the four diameters by the density', () => {
    const one = densityFor(12)
    const braid = densityFor(400)

    expect(BAND_DIAMETERS).toEqual([10, 14, 18, 24])
    expect([0, 1, 2, 3].map((band) => beadDiameter(band as 0 | 1 | 2 | 3, one))).toEqual([
      10, 14, 18, 24,
    ])
    expect(
      [0, 1, 2, 3].map((band) => beadDiameter(band as 0 | 1 | 2 | 3, braid)),
    ).toEqual([6, 8, 10, 14])
  })
})

describe('where a bead sits', () => {
  it('snakes: left to right, then right to left', () => {
    const three = densityFor(150)

    expect([0, 1, 2, 3, 4, 5].map((i) => positionFor(i, three).cord)).toEqual([
      0, 1, 2, 2, 1, 0,
    ])
  })

  it('spaces cords evenly about the centre line', () => {
    const three = densityFor(150)
    const xs = [0, 1, 2].map((i) => positionFor(i, three).x)

    expect(xs).toEqual([-CORD_PITCH, 0, CORD_PITCH])
    expect(xs.reduce((total, x) => total + x, 0)).toBe(0)
  })

  it('steps down by the pitch, one row at a time', () => {
    const two = densityFor(50)

    expect(positionFor(0, two).y).toBe(12)
    expect(positionFor(1, two).y).toBe(12)
    expect(positionFor(2, two).y).toBe(12 + two.pitch)
  })

  it('gives the strand a height that holds every row', () => {
    const braid = densityFor(400)

    expect(rowsFor(400, braid)).toBe(80)
    expect(strandHeight(400, braid)).toBe(80 * 18 + 24)
    // One over a full row still gets its own row rather than overflowing.
    expect(rowsFor(401, braid)).toBe(81)
  })
})

describe('how long ago', () => {
  const now = new Date('2026-08-16T12:00:00.000Z')

  it('floors to whole days and never goes negative', () => {
    expect(daysBetween(now, now)).toBe(0)
    expect(daysBetween(new Date('2026-08-16T00:00:00.000Z'), now)).toBe(0)
    expect(daysBetween(new Date('2026-08-15T11:00:00.000Z'), now)).toBe(1)
    expect(daysBetween(new Date('2026-08-06T12:00:00.000Z'), now)).toBe(10)
    // A clock skewed forward on the writing side must not read as "-1 days".
    expect(daysBetween(new Date('2026-08-17T12:00:00.000Z'), now)).toBe(0)
  })
})
