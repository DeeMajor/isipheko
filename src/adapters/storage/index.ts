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
 * **There is no production implementation, so this refuses in production** —
 * the same posture as `smsSender`, `identityVerifier` and `paymentProvider`.
 *
 * It used to warn instead, on the grounds that *a missing OG cache costs a
 * redraw, not a person waiting for a code that never comes*. That was true when
 * an OG card was the only thing in here. It stopped being true at M4-01, which
 * put **contributor photographs** in the same store and deliberately keeps no
 * original — only the four re-encodes exist, because keeping the source would
 * keep its GPS with it (M4-01 §5). M4-03 then added album PDFs.
 *
 * So the cost of falling back is no longer a redraw. It is a photograph
 * somebody attached to a funeral, written to one container's disk, gone on the
 * next deploy and invisible to every other instance in the meantime — with
 * nothing anywhere saying so, because the warning is one line in a log on the
 * day of deployment and the loss happens weeks later.
 *
 * See docs/decisions.md OPS-09.
 */
/**
 * Where the local store writes. Declared in `src/lib/env.ts` so it is not the
 * one variable exempt from M1-01's refusal-to-start guarantee, and read from
 * `process.env` here rather than from the validated `env` because
 * `scripts/render.ts` reaches this file under plain Node.
 */
const CACHE_ROOT =
  process.env.OBJECT_STORE_DIR ?? join(process.cwd(), '.cache', 'objects')

interface StoreHolder {
  __isiphekoObjectStore?: ObjectStore
}

export function objectStore(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): ObjectStore {
  if (nodeEnv === 'production') {
    throw new Error(
      'No object storage is configured. Architecture §3 wants S3-compatible storage in ' +
        'af-south-1 (implementation-plan Part J item 4) — choose it, add the adapter, and ' +
        'wire it here. Do not fall back to the local store: a contributor photograph has ' +
        'no original kept anywhere (M4-01 §5), so one written to a container disk is lost ' +
        'on the next deploy and unreadable from every other instance before that.',
    )
  }

  const holder = globalThis as unknown as StoreHolder

  holder.__isiphekoObjectStore ??= new LocalObjectStore(CACHE_ROOT)

  return holder.__isiphekoObjectStore
}
