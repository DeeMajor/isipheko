import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

import {
  ObjectStoreError,
  isValidObjectKey,
  type ObjectKey,
  type ObjectStore,
  type StoredObject,
} from '../../domain/storage/index.ts'

/**
 * The object store that exists until a bucket does.
 *
 * Writes under a cache directory on the local disk. On more than one instance
 * each caches separately — which is a real limitation and an accepted one: the
 * OG card's URL is content-addressed and served `immutable`, so Cloudflare
 * holds it at the edge and the origin cache only saves a redraw. The property
 * that matters is "not generated per request", and that holds per instance.
 *
 * **This is not the production answer.** Architecture §3 wants S3-compatible
 * storage in `af-south-1`; §15 item 6 has not chosen a region yet. When it
 * does, an `S3ObjectStore` implements the same three methods and this file
 * stops being reachable.
 */

/** The content type is stored beside the bytes so `get` can return it. */
const META_SUFFIX = '.type'

export class LocalObjectStore implements ObjectStore {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  private pathFor(key: ObjectKey): string {
    if (!isValidObjectKey(key)) {
      // The message names no key. Keys are not secret here, but this class is
      // the one place a caller's mistake becomes a filesystem path.
      throw new ObjectStoreError('Refusing an object key that is not well formed')
    }

    const path = resolve(join(this.root, key))

    // Belt and braces: `isValidObjectKey` already refuses `..`, and this
    // refuses anything that still resolves outside the root.
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new ObjectStoreError('Refusing an object key that escapes the store')
    }

    return path
  }

  async get(key: ObjectKey): Promise<StoredObject | null> {
    const path = this.pathFor(key)

    try {
      const [bytes, contentType] = await Promise.all([
        readFile(path),
        readFile(`${path}${META_SUFFIX}`, 'utf8'),
      ])

      return { bytes: new Uint8Array(bytes), contentType: contentType.trim() }
    } catch {
      // Absent, unreadable, half-written: all of them mean "generate it again",
      // which is correct and cheap. A cache that throws is worse than a miss.
      return null
    }
  }

  async put(key: ObjectKey, object: StoredObject): Promise<void> {
    const path = this.pathFor(key)
    await mkdir(dirname(path), { recursive: true })

    /*
     * Written to a temporary name and renamed into place.
     *
     * Two requests for a cold card race each other, and `rename` is atomic on
     * a local filesystem — so a reader never sees a half-written PNG, which
     * would be a broken preview cached by WhatsApp for as long as it feels
     * like. The loser of the race overwrites identical bytes: the key is a
     * hash of the content.
     */
    const scratch = `${path}.${process.pid.toString(36)}.${Math.random().toString(36).slice(2)}`

    await writeFile(scratch, object.bytes)
    await writeFile(`${scratch}${META_SUFFIX}`, object.contentType)
    await rename(`${scratch}${META_SUFFIX}`, `${path}${META_SUFFIX}`)
    await rename(scratch, path)
  }

  async has(key: ObjectKey): Promise<boolean> {
    return (await this.get(key)) !== null
  }
}
