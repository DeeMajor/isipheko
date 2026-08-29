import { inflateSync } from 'node:zlib'

/**
 * WOFF1 back to the TrueType file it was made from.
 *
 * `pdf-lib` embeds `ttf` and `otf`. The site ships `woff2`, which no browser
 * would thank us for changing, and `src/assets/fonts/` already holds two
 * **WOFF1** files that M2-07 added for Satori — *"two separate binaries that no
 * browser ever downloads"*. Those are the ones this reads.
 *
 * The alternative was committing two more binaries in a third format. This is
 * better for a reason beyond tidiness: the printed album provably uses the same
 * font file the site does, rather than one that was converted somewhere else,
 * at some point, by somebody.
 *
 * **WOFF1 is an sfnt with the tables individually zlib'd** and a 44-byte header
 * in front — no glyph transform, no brotli, none of what makes WOFF2 a project.
 * Undoing it is: read the directory, inflate each table, write a normal sfnt
 * directory, and pad each table to four bytes. The checksums are copied through
 * from the WOFF directory rather than recomputed, because they were computed
 * over exactly these uncompressed bytes.
 */

export class WoffError extends Error {
  override readonly name = 'WoffError'
}

const WOFF_SIGNATURE = 0x774f4646 // 'wOFF'
const WOFF_HEADER_BYTES = 44
const WOFF_ENTRY_BYTES = 20
const SFNT_HEADER_BYTES = 12
const SFNT_ENTRY_BYTES = 16

/** sfnt tables are aligned to four bytes, and the padding is not optional. */
const padded = (length: number): number => (length + 3) & ~3

interface TableEntry {
  readonly tag: number
  readonly checksum: number
  readonly bytes: Uint8Array
}

export function woffToTtf(woff: Uint8Array): Uint8Array {
  const source = new DataView(woff.buffer, woff.byteOffset, woff.byteLength)

  if (woff.byteLength < WOFF_HEADER_BYTES || source.getUint32(0) !== WOFF_SIGNATURE) {
    throw new WoffError('Not a WOFF1 file')
  }

  const flavour = source.getUint32(4)
  const tableCount = source.getUint16(12)

  const tables: TableEntry[] = []

  for (let index = 0; index < tableCount; index += 1) {
    const at = WOFF_HEADER_BYTES + index * WOFF_ENTRY_BYTES
    if (at + WOFF_ENTRY_BYTES > woff.byteLength) {
      throw new WoffError('WOFF table directory runs past the end of the file')
    }

    const tag = source.getUint32(at)
    const offset = source.getUint32(at + 4)
    const compressedLength = source.getUint32(at + 8)
    const originalLength = source.getUint32(at + 12)
    const checksum = source.getUint32(at + 16)

    if (offset + compressedLength > woff.byteLength) {
      throw new WoffError('WOFF table runs past the end of the file')
    }

    const stored = woff.subarray(offset, offset + compressedLength)

    // Equal lengths mean the table was stored uncompressed, which the spec
    // allows for tables zlib would have made bigger.
    const bytes =
      compressedLength === originalLength ? stored : new Uint8Array(inflateSync(stored))

    if (bytes.byteLength !== originalLength) {
      throw new WoffError('A WOFF table did not inflate to its declared length')
    }

    tables.push({ tag, checksum, bytes })
  }

  // The sfnt directory is sorted by tag. WOFF's usually is too, but "usually"
  // is not a property a font parser will forgive.
  tables.sort((a, b) => a.tag - b.tag)

  const directoryBytes = SFNT_HEADER_BYTES + tables.length * SFNT_ENTRY_BYTES
  const total = tables.reduce(
    (sum, table) => sum + padded(table.bytes.byteLength),
    directoryBytes,
  )

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)

  /*
   * searchRange, entrySelector and rangeShift: a binary-search hint no modern
   * parser uses and every validator checks. `entrySelector` is floor(log2(n)),
   * `searchRange` is 16 × 2^entrySelector, and `rangeShift` is what is left.
   */
  const entrySelector = Math.floor(Math.log2(tables.length))
  const searchRange = 16 * 2 ** entrySelector

  view.setUint32(0, flavour)
  view.setUint16(4, tables.length)
  view.setUint16(6, searchRange)
  view.setUint16(8, entrySelector)
  view.setUint16(10, tables.length * 16 - searchRange)

  let offset = directoryBytes

  tables.forEach((table, index) => {
    const at = SFNT_HEADER_BYTES + index * SFNT_ENTRY_BYTES

    view.setUint32(at, table.tag)
    view.setUint32(at + 4, table.checksum)
    view.setUint32(at + 8, offset)
    view.setUint32(at + 12, table.bytes.byteLength)

    out.set(table.bytes, offset)
    // The gap to the next four-byte boundary stays zero, which is what the
    // checksums above were computed over.
    offset += padded(table.bytes.byteLength)
  })

  return out
}
