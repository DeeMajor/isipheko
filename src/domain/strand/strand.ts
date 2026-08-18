/**
 * The Ledger Strand — implementation plan Part C.4.
 *
 * The signature element of the product, and the thing it is named for: the
 * incwadi, the book kept at the door of a ceremony. It is **not a chart**. It
 * shows that people came and roughly what they brought, and it deliberately
 * refuses to show a total, a count, a target, or any amount at all.
 *
 * This module is pure arithmetic: which band a count falls in, how big a bead
 * is, and where it sits. Nothing here knows about React, the database, or an
 * archetype's copy — it takes the two flags it needs and returns numbers.
 *
 * Three properties are load-bearing rather than decorative:
 *
 * **Bands are unlabelled**, so nobody reverse-engineers an amount from a
 * diameter. Four coarse sizes over the whole range of contributions is as much
 * as the picture says.
 *
 * **Where amounts are hidden, diameters are uniform.** Four monotonic sizes
 * leak a coarse amount to anybody willing to compare two beads, and comparing
 * what people gave is exactly what a hidden-amounts event exists to prevent
 * (architecture §7.3). The rule reads `amountsPublic` — the same flag that sets
 * the visibility default — so the two cannot disagree.
 *
 * **In-kind is never smaller than cash.** A pure in-kind contribution has no
 * amount to band, so it takes a fixed middle diameter. Reading smaller would
 * break the equal-mass rule that makes the two forms peers rather than a
 * primary and a fallback, and in-kind is the core of what *isipheko* means.
 */

import type { Money } from '../money/index.ts'

export interface DensityBand {
  /** The largest contribution count this band covers. */
  readonly max: number
  readonly cords: number
  /** Vertical distance between beads, in px. */
  readonly pitch: number
  /** Multiplier applied to every bead diameter in this band. */
  readonly scale: number
}

/**
 * The last band, named so `densityFor` has something to fall back to without a
 * non-null assertion. Its `max` is Infinity, so the fallback is unreachable.
 */
const BRAIDED: DensityBand = {
  max: Number.POSITIVE_INFINITY,
  cords: 5,
  pitch: 18,
  scale: 0.58,
}

/**
 * Part C.4, exactly. Not a starting point — the numbers were settled against
 * the reference screens, and a strand that thickens instead of running on down
 * the page is the whole idea.
 */
export const DENSITY: readonly DensityBand[] = [
  { max: 30, cords: 1, pitch: 46, scale: 1 },
  { max: 80, cords: 2, pitch: 40, scale: 0.92 },
  { max: 200, cords: 3, pitch: 30, scale: 0.78 },
  BRAIDED,
]

/** Horizontal distance between cords, in px. From `design/event.html`. */
export const CORD_PITCH = 64

export function densityFor(count: number): DensityBand {
  return DENSITY.find((band) => count <= band.max) ?? BRAIDED
}

/** The four coarse diameters, in px, before the density scale. */
export const BAND_DIAMETERS = [10, 14, 18, 24] as const

export type SizeBand = 0 | 1 | 2 | 3

/**
 * The cash bands, in integer cents.
 *
 * Coarse on purpose. Four buckets over every contribution an umcimbi receives
 * says "some gave more" and stops there, which is as much as a picture of a
 * strand should say.
 */
export const BAND_THRESHOLDS_CENTS = [10_000n, 50_000n, 200_000n] as const

/**
 * The diameter an in-kind bead takes, and the one every bead takes where
 * amounts are hidden: 14px, the second band.
 */
export const UNIFORM_BAND: SizeBand = 1

export type BeadForm = 'cash' | 'in_kind' | 'group'

export interface BandInput {
  readonly form: BeadForm
  /** Null for a pure in-kind contribution, and for a group. */
  readonly amount: Money | null
  /** `ArchetypeConfig.amountsPublic`. False hides amounts, so sizes go uniform. */
  readonly amountsPublic: boolean
}

export function bandFor({ form, amount, amountsPublic }: BandInput): SizeBand {
  if (!amountsPublic) return UNIFORM_BAND
  if (form !== 'cash') return UNIFORM_BAND
  if (amount === null) return UNIFORM_BAND

  if (amount < BAND_THRESHOLDS_CENTS[0]) return 0
  if (amount < BAND_THRESHOLDS_CENTS[1]) return 1
  if (amount < BAND_THRESHOLDS_CENTS[2]) return 2

  return 3
}

/** The rendered diameter in px: the band's size, scaled by the density. */
export function beadDiameter(band: SizeBand, density: DensityBand): number {
  return Math.round(BAND_DIAMETERS[band] * density.scale)
}

export interface BeadPosition {
  readonly row: number
  /** Which cord, left to right, zero-based. */
  readonly cord: number
  /** Offset from the centre line in px, negative to the left. */
  readonly x: number
  /** Distance from the top of the strand in px. */
  readonly y: number
}

/**
 * Where the nth bead sits when the strand braids across more than one cord.
 *
 * The order snakes: left to right on one row, right to left on the next. A
 * strand is strung, not tabulated, and reading it should follow the string
 * rather than jump back to a margin.
 */
export function positionFor(index: number, density: DensityBand): BeadPosition {
  const row = Math.floor(index / density.cords)
  const withinRow = index % density.cords
  const cord = row % 2 === 0 ? withinRow : density.cords - 1 - withinRow

  return {
    row,
    cord,
    x: Math.round((cord - (density.cords - 1) / 2) * CORD_PITCH),
    y: Math.round(12 + row * density.pitch),
  }
}

/** How many rows a strand of this many beads occupies. */
export function rowsFor(count: number, density: DensityBand): number {
  return Math.ceil(count / density.cords)
}

/** The height the braided strand needs, in px. */
export function strandHeight(count: number, density: DensityBand): number {
  return rowsFor(count, density) * density.pitch + 24
}

/**
 * Whole days between two instants, floored — for "3 days ago" on an opened
 * bead. Never rendered as a count of anything but time.
 */
export function daysBetween(then: Date, now: Date): number {
  const elapsed = now.getTime() - then.getTime()
  if (elapsed <= 0) return 0

  return Math.floor(elapsed / (24 * 60 * 60 * 1000))
}
