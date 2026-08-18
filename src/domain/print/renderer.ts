import type { ArchetypeConfig } from '../archetype/index.ts'

/**
 * The PDF boundary.
 *
 * Declared here and implemented in `src/adapters/pdf/`, the same inversion the
 * payment provider, the object store and the image processor use (CLAUDE.md
 * rules 6 and 10). **Nothing in `src/domain/`, `src/app/` or `src/ui/` imports
 * `pdf-lib`**, and the one file that does is the adapter.
 */

/**
 * A photograph, already decoded to something a PDF can hold.
 *
 * PDF embeds JPEG and PNG. It embeds neither AVIF nor WebP, which is all M4-01
 * stores — so somebody has to transcode, and that somebody is `sharp`, which is
 * already a dependency. The pixel dimensions travel with the bytes because the
 * page has to know how big the picture is before it decides where to put it.
 */
export interface PrintablePhoto {
  readonly jpeg: Uint8Array
  readonly width: number
  readonly height: number
}

/** One person on the record, as the printed page needs them. */
export interface PrintableEntry {
  readonly id: string
  /** Already resolved to "Someone" for a quiet giver — the renderer decides
   *  nothing about who is named. */
  readonly name: string
  /** "Money", "Bringing Chairs × 10", "5 together". */
  readonly what: string
  readonly message: string | null
  readonly members: readonly string[]
  readonly membersLabel: string | null
  readonly when: string
  readonly photo: PrintablePhoto | null
}

/**
 * A bead on the cover.
 *
 * `diameter` is already banded, so **no amount reaches this layer at all**. The
 * band is what the amount was for (Part C.4) and the renderer never sees the
 * number behind it — which is what makes "no amount in the printed album" a
 * property of the types rather than of somebody's care.
 */
export interface PrintableBead {
  readonly x: number
  readonly y: number
  readonly diameter: number
  readonly form: 'cash' | 'in_kind' | 'group'
}

export interface PrintableCover {
  readonly title: string
  readonly kicker: string
  readonly organiserName: string | null
  readonly meta: string | null
  readonly intro: string
  readonly beads: readonly PrintableBead[]
  readonly strandHeight: number
}

export interface PrintableAlbum {
  readonly archetype: ArchetypeConfig
  readonly cover: PrintableCover
  readonly entries: readonly PrintableEntry[]
  /** Rendered onto the colophon, so a printer knows before opening the file. */
  readonly colophon: readonly string[]
  /** Supplied rather than read from a clock, so the same album renders the
   *  same file twice (the same rule the ledger hash follows). */
  readonly generatedAt: Date
}

export interface AlbumRenderer {
  render(album: PrintableAlbum): Promise<Uint8Array>
}
