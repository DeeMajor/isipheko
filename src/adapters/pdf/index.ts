// Relative with explicit extensions: `scripts/render.ts` loads this under plain
// Node, which resolves no tsconfig aliases (docs/decisions.md M2-01 §8).
import type { AlbumRenderer } from '../../domain/print/index.ts'

import { PdfLibAlbumRenderer } from './pdf-lib-renderer.ts'

export { PdfLibAlbumRenderer } from './pdf-lib-renderer.ts'
export { WoffError, woffToTtf } from './woff-to-ttf.ts'

/**
 * The renderer the application uses. One per process, like the other adapters —
 * it holds the converted fonts, which are worth not converting twice.
 */
interface RendererHolder {
  __isiphekoAlbumRenderer?: AlbumRenderer
}

export function albumRenderer(): AlbumRenderer {
  const holder = globalThis as unknown as RendererHolder
  holder.__isiphekoAlbumRenderer ??= new PdfLibAlbumRenderer()

  return holder.__isiphekoAlbumRenderer
}
