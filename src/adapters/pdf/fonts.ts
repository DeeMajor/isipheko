import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { woffToTtf } from './woff-to-ttf.ts'

/**
 * Public Sans, as TrueType, for embedding.
 *
 * `src/assets/fonts/` holds **WOFF1** — added by M2-07 so Satori could draw the
 * OG card, and described there as *"two separate binaries that no browser ever
 * downloads"*. `pdf-lib` wants `ttf` or `otf`, and WOFF1 is an sfnt with the
 * tables individually zlib'd, so `woffToTtf` gets there with `node:zlib` and no
 * third copy of the typeface in the repository.
 *
 * Converted once per process and held. The files do not change under a running
 * job, and a render that reads and inflates 37KB per album is waste on a path
 * that already costs seconds.
 */

const FONT_DIR = join(process.cwd(), 'src', 'assets', 'fonts')

export interface PrintFonts {
  readonly regular: Uint8Array
  readonly heavy: Uint8Array
}

let cached: Promise<PrintFonts> | null = null

export function loadPrintFonts(): Promise<PrintFonts> {
  cached ??= Promise.all([
    readFile(join(FONT_DIR, 'public-sans-latin-400.woff')),
    readFile(join(FONT_DIR, 'public-sans-latin-800.woff')),
  ]).then(([regular, heavy]) => ({
    regular: woffToTtf(new Uint8Array(regular)),
    heavy: woffToTtf(new Uint8Array(heavy)),
  }))

  return cached
}
