/**
 * The contract for sending an email.
 *
 * The fallback channel of architecture §8.2, for **organisers and witnesses
 * only**: a contributor has no account and is never asked for an address (rule
 * 4), so where there is no phone number there is nothing to fall back to. That
 * is a deviation from §8.2 as written and it is recorded in docs/decisions.md
 * M2-08 — the answer is that some contributors are not notified, not that this
 * product starts collecting addresses to fix it.
 *
 * No provider has been chosen. Architecture §3 wants one processing in the EU
 * or South Africa; until then the only implementation holds messages in memory
 * and production refuses to construct one.
 */

export interface EmailMessage {
  readonly to: string
  readonly subject: string
  /** Plain text. Receipts and fallbacks only — there is no marketing email. */
  readonly body: string
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>
}
