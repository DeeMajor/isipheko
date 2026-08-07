import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

import { ColumnCipherError, type ColumnCipher } from '@/domain/crypto/column-cipher'

/**
 * AES-256-GCM column encryption for bank account numbers (architecture §10,
 * CLAUDE.md rule 8).
 *
 * **The key comes from the environment. That is a stopgap, not the design.**
 * Architecture §10 puts this key in a KMS, held separately from the database
 * credential, and it belongs there before anything real is stored. It is an
 * environment variable today only because the KMS decision has not been taken,
 * and the whole point of `ColumnCipher` is that taking it later costs one file.
 * See docs/decisions.md M1-02.
 *
 * GCM rather than CBC because the tag makes tampering detectable. An encrypted
 * account number that silently decrypts to a different account number is a
 * payment sent to the wrong person.
 */

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12 // 96 bits, the size GCM is specified for
const TAG_BYTES = 16

/**
 * Prefix every stored value. When the key moves to a KMS the scheme changes,
 * and a stored value has to say which scheme produced it or nothing can be read
 * back. Retrofitting a version marker onto unmarked ciphertext is not possible.
 */
const VERSION = 'v1'

/**
 * Bound into the GCM tag as additional authenticated data. It does not hide
 * anything — it means a ciphertext lifted from one column cannot be pasted into
 * another and still authenticate, so a swapped column is a decryption failure
 * rather than a plausible wrong answer.
 */
export type CipherContext = 'bank_account_number' | 'id_number'

export function createColumnCipher(key: Buffer, context: CipherContext): ColumnCipher {
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `Column encryption key must be ${String(KEY_BYTES)} bytes; received ${String(key.length)}.`,
    )
  }

  const aad = Buffer.from(`${VERSION}:${context}`, 'utf8')

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv(ALGORITHM, key, iv)
      cipher.setAAD(aad)

      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

      return [
        VERSION,
        context,
        iv.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        ciphertext.toString('base64'),
      ].join('.')
    },

    decrypt(stored: string): string {
      const parts = stored.split('.')
      if (parts.length !== 5) {
        throw new ColumnCipherError('value is not in the expected format')
      }

      const [version, storedContext, ivPart, tagPart, ciphertextPart] = parts as [
        string,
        string,
        string,
        string,
        string,
      ]

      if (version !== VERSION) {
        throw new ColumnCipherError(`unknown scheme version ${version}`)
      }
      if (storedContext !== context) {
        throw new ColumnCipherError(`value belongs to a different column`)
      }

      const iv = Buffer.from(ivPart, 'base64')
      const tag = Buffer.from(tagPart, 'base64')
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
        throw new ColumnCipherError('value is truncated or malformed')
      }

      const decipher = createDecipheriv(ALGORITHM, key, iv)
      decipher.setAAD(aad)
      decipher.setAuthTag(tag)

      try {
        return Buffer.concat([
          decipher.update(Buffer.from(ciphertextPart, 'base64')),
          decipher.final(),
        ]).toString('utf8')
      } catch {
        // The underlying error is a bare "Unsupported state or unable to
        // authenticate data". Say what it means: the value is not what was
        // written. Deliberately not distinguishing a wrong key from a modified
        // ciphertext — the caller can do nothing different, and the distinction
        // is only useful to someone probing.
        throw new ColumnCipherError(
          'authentication failed — the value was altered or the key is wrong',
        )
      }
    },
  }
}

/**
 * Peppered hash for the ID number (architecture §7.3). Not encryption: there is
 * no way back, and none is wanted. It exists so two organisers cannot register
 * the same identity, and for nothing else.
 *
 * The pepper lives outside the database — an environment variable today, a KMS
 * later, the same stopgap as above. A pepper stored next to the hashes it
 * protects would be no protection at all.
 */
export function hashIdNumber(idNumber: string, pepper: Buffer): string {
  return createHash('sha256')
    .update(pepper)
    .update(idNumber.replace(/\s/g, ''))
    .digest('base64')
}

/** Constant-time comparison for the rare case of checking a hash by hand. */
export function idNumberHashEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'base64')
  const right = Buffer.from(b, 'base64')
  return left.length === right.length && timingSafeEqual(left, right)
}
