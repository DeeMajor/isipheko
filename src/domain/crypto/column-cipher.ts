/**
 * The contract for encrypting a single column value at rest.
 *
 * It lives in domain/ and is implemented in db/ — the dependency inversion
 * CLAUDE.md rule 6 describes. Domain and application code depend on this
 * interface and never on the implementation, which is what allows the key to
 * move from an environment variable to a KMS without touching anything that
 * uses it. That move is expected: see docs/decisions.md M1-02.
 *
 * Deterministic encryption is deliberately not offered. A deterministic scheme
 * would let equal ciphertexts reveal equal account numbers, and the queries this
 * product runs never need to search on an encrypted column.
 */

export interface ColumnCipher {
  /** Returns a self-describing, versioned string safe to store in a text column. */
  encrypt(plaintext: string): string
  /** Throws {@link ColumnCipherError} if the value was tampered with or truncated. */
  decrypt(ciphertext: string): string
}

/**
 * Carries no plaintext, no ciphertext and no key material — only what went
 * wrong structurally. This message reaches logs (CLAUDE.md rule 8).
 */
export class ColumnCipherError extends Error {
  override readonly name = 'ColumnCipherError'

  constructor(reason: string) {
    super(`Column decryption failed: ${reason}`)
  }
}
