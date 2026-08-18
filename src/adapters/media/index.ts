import type { ImageProcessor } from '@/domain/media'

import { SharpImageProcessor } from './sharp-image-processor'

export { SharpImageProcessor } from './sharp-image-processor'

/**
 * The processor the application uses.
 *
 * One instance per process, on `globalThis` for the same reason the object
 * store is: Next's module reloading in development would otherwise hand two
 * halves of a request different ones. It holds no state, but the shape stays
 * the same as the other adapters so nobody has to remember which is which.
 */
interface ProcessorHolder {
  __isiphekoImageProcessor?: ImageProcessor
}

export function imageProcessor(): ImageProcessor {
  const holder = globalThis as unknown as ProcessorHolder
  holder.__isiphekoImageProcessor ??= new SharpImageProcessor()

  return holder.__isiphekoImageProcessor
}
