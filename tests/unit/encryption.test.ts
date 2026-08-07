import { describe, expect, it } from 'vitest'

import { createColumnCipher, hashIdNumber, idNumberHashEquals } from '@/db/encryption'
import { ColumnCipherError } from '@/domain/crypto/column-cipher'

/**
 * A bank account number that decrypts to a different bank account number is a
 * payment sent to the wrong person, so most of what follows is about detecting
 * tampering rather than about round-tripping.
 */

const KEY = Buffer.alloc(32, 7)
const OTHER_KEY = Buffer.alloc(32, 9)
const ACCOUNT_NUMBER = '1234567890'

describe('createColumnCipher', () => {
  it('round-trips a value', () => {
    const cipher = createColumnCipher(KEY, 'bank_account_number')

    expect(cipher.decrypt(cipher.encrypt(ACCOUNT_NUMBER))).toBe(ACCOUNT_NUMBER)
  })

  it('never stores the plaintext', () => {
    const stored = createColumnCipher(KEY, 'bank_account_number').encrypt(ACCOUNT_NUMBER)

    expect(stored).not.toContain(ACCOUNT_NUMBER)
  })

  // Not an optimisation detail. Equal ciphertexts would reveal equal account
  // numbers to anyone holding a database dump.
  it('produces a different ciphertext each time for the same input', () => {
    const cipher = createColumnCipher(KEY, 'bank_account_number')

    expect(cipher.encrypt(ACCOUNT_NUMBER)).not.toBe(cipher.encrypt(ACCOUNT_NUMBER))
  })

  it('carries a scheme version, so the KMS migration has something to branch on', () => {
    expect(
      createColumnCipher(KEY, 'bank_account_number').encrypt(ACCOUNT_NUMBER),
    ).toMatch(/^v1\./)
  })

  it('rejects a key that is not 32 bytes', () => {
    expect(() => createColumnCipher(Buffer.alloc(16, 1), 'bank_account_number')).toThrow(
      /32 bytes/,
    )
  })

  describe('tamper detection', () => {
    it('refuses a value encrypted under a different key', () => {
      const stored = createColumnCipher(OTHER_KEY, 'bank_account_number').encrypt(
        ACCOUNT_NUMBER,
      )

      expect(() =>
        createColumnCipher(KEY, 'bank_account_number').decrypt(stored),
      ).toThrow(ColumnCipherError)
    })

    // The realistic database-level attack: move a value from one column to
    // another and hope it still reads. The AAD makes that a failure rather than
    // a plausible wrong answer.
    it('refuses a value lifted from a different column', () => {
      const stored = createColumnCipher(KEY, 'id_number').encrypt(ACCOUNT_NUMBER)

      expect(() =>
        createColumnCipher(KEY, 'bank_account_number').decrypt(stored),
      ).toThrow(/different column/)
    })

    it('refuses a modified ciphertext', () => {
      const cipher = createColumnCipher(KEY, 'bank_account_number')
      const parts = cipher.encrypt(ACCOUNT_NUMBER).split('.')
      const body = Buffer.from(parts[4] as string, 'base64')
      body[0] = body.readUInt8(0) ^ 0xff
      parts[4] = body.toString('base64')

      expect(() => cipher.decrypt(parts.join('.'))).toThrow(ColumnCipherError)
    })

    it('refuses a modified authentication tag', () => {
      const cipher = createColumnCipher(KEY, 'bank_account_number')
      const parts = cipher.encrypt(ACCOUNT_NUMBER).split('.')
      const tag = Buffer.from(parts[3] as string, 'base64')
      tag[0] = tag.readUInt8(0) ^ 0xff
      parts[3] = tag.toString('base64')

      expect(() => cipher.decrypt(parts.join('.'))).toThrow(ColumnCipherError)
    })

    it('refuses a truncated value rather than guessing', () => {
      const cipher = createColumnCipher(KEY, 'bank_account_number')

      expect(() => cipher.decrypt('v1.bank_account_number.short')).toThrow(
        /not in the expected format/,
      )
    })

    it('refuses an unknown scheme version', () => {
      const cipher = createColumnCipher(KEY, 'bank_account_number')
      const parts = cipher.encrypt(ACCOUNT_NUMBER).split('.')
      parts[0] = 'v2'

      expect(() => cipher.decrypt(parts.join('.'))).toThrow(/unknown scheme version/)
    })
  })

  // CLAUDE.md rule 8: this message reaches logs.
  it('puts neither plaintext nor key material in the error', () => {
    const stored = createColumnCipher(OTHER_KEY, 'bank_account_number').encrypt(
      ACCOUNT_NUMBER,
    )

    try {
      createColumnCipher(KEY, 'bank_account_number').decrypt(stored)
      expect.unreachable('decrypt should have thrown')
    } catch (error) {
      const message = (error as Error).message
      expect(message).not.toContain(ACCOUNT_NUMBER)
      expect(message).not.toContain(KEY.toString('base64'))
      expect(message).not.toContain(stored)
    }
  })
})

describe('hashIdNumber', () => {
  const PEPPER = Buffer.alloc(32, 3)
  const ID_NUMBER = '5306075800082'

  it('is stable for the same input and pepper, so uniqueness checks work', () => {
    expect(hashIdNumber(ID_NUMBER, PEPPER)).toBe(hashIdNumber(ID_NUMBER, PEPPER))
  })

  it('differs under a different pepper', () => {
    expect(hashIdNumber(ID_NUMBER, PEPPER)).not.toBe(
      hashIdNumber(ID_NUMBER, Buffer.alloc(32, 4)),
    )
  })

  it('never contains the ID number', () => {
    expect(hashIdNumber(ID_NUMBER, PEPPER)).not.toContain(ID_NUMBER)
  })

  // People type ID numbers with spaces. Two records for one person would defeat
  // the uniqueness check the hash exists for.
  it('ignores whitespace, so one person hashes to one value', () => {
    expect(hashIdNumber('530 607 5800 082', PEPPER)).toBe(hashIdNumber(ID_NUMBER, PEPPER))
  })

  it('distinguishes different identities', () => {
    expect(hashIdNumber(ID_NUMBER, PEPPER)).not.toBe(
      hashIdNumber('5306075800083', PEPPER),
    )
  })
})

describe('idNumberHashEquals', () => {
  const PEPPER = Buffer.alloc(32, 3)

  it('matches a hash against itself', () => {
    const hash = hashIdNumber('5306075800082', PEPPER)

    expect(idNumberHashEquals(hash, hash)).toBe(true)
  })

  it('rejects a different hash', () => {
    expect(
      idNumberHashEquals(
        hashIdNumber('5306075800082', PEPPER),
        hashIdNumber('5306075800083', PEPPER),
      ),
    ).toBe(false)
  })

  it('rejects a length mismatch without throwing', () => {
    expect(idNumberHashEquals(hashIdNumber('5306075800082', PEPPER), 'c2hvcnQ=')).toBe(
      false,
    )
  })
})
