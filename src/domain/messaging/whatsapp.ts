import type { TemplateId } from './templates.ts'

/**
 * The contract for sending a WhatsApp **template** message, via a Business
 * Solution Provider.
 *
 * Same shape as `SmsSender` and for the same reason (§5.1): the interface lives
 * in `domain/`, the implementation lives in `adapters/`, and nothing outside
 * `adapters/` knows which BSP is behind it. **No BSP has been chosen** —
 * implementation-plan Part J item 3 — so the only implementation today holds
 * messages in memory, and production refuses to construct one rather than
 * dropping a message somebody is waiting for.
 *
 * It sends a template and its parameters, never a body. Business-initiated
 * WhatsApp is templates-only, the template's category decides the rate, and a
 * `send(body)` interface would invite somebody to compose a message that is not
 * a registered template and discover it at the API boundary.
 */

export interface WhatsAppTemplateMessage {
  /** E.164. Normalise before you get here. */
  readonly to: string
  readonly template: TemplateId
  /** The registered name, so the adapter needs no registry of its own. */
  readonly metaName: string
  readonly language: string
  /** Positional, filling `{{1}}` onward. Built by `orderParams`. */
  readonly params: readonly string[]
}

export interface WhatsAppSender {
  send(message: WhatsAppTemplateMessage): Promise<void>
}
