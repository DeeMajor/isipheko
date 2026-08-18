import { join } from 'node:path'

// Relative with explicit extensions: `scripts/render.ts` reaches this through
// the album pipeline under plain Node (docs/decisions.md M2-01 §8).
import type { ObjectStore } from '../../domain/storage/index.ts'

import { LocalObjectStore } from './local-object-store.ts'

export { LocalObjectStore } from './local-object-store.ts'

/**
 * The store the application uses.
 *
 * One instance per process — the local implementation holds only a path, and a
 * future S3 one will hold a client worth reusing. On `globalThis` so Next's
 * module reloading in development does not hand two halves of a request
 * different stores.
 *
 * **There is no production implementation yet.** Unlike `smsSender`, this does
 * not throw in production: a missing OG cache costs a redraw, not a person
 * waiting for a code that never comes. It does say so once, so that the day
 * this ships to a real deployment somebody sees it in the logs rather than
 * discovering it in a bill.
 */
const CACHE_ROOT =
  process.env.OBJECT_STORE_DIR ?? join(process.cwd(), '.cache', 'objects')

interface StoreHolder {
  __isiphekoObjectStore?: ObjectStore
  __isiphekoObjectStoreWarned?: boolean
}

export function objectStore(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): ObjectStore {
  const holder = globalThis as unknown as StoreHolder

  if (nodeEnv === 'production' && holder.__isiphekoObjectStoreWarned !== true) {
    holder.__isiphekoObjectStoreWarned = true
    console.warn(
      '[storage] No object storage is configured; caching generated images on local disk. ' +
        'Architecture §3 wants S3-compatible storage in af-south-1 (open item 6). ' +
        'On more than one instance this caches per instance.',
    )
  }

  holder.__isiphekoObjectStore ??= new LocalObjectStore(CACHE_ROOT)

  return holder.__isiphekoObjectStore
}
