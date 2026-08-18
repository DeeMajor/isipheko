import type {
  WhatsAppSender,
  WhatsAppTemplateMessage,
} from '../../domain/messaging/index.ts'

/**
 * The development and test WhatsApp sender.
 *
 * It keeps every message it was given, in order, and **writes nothing
 * anywhere** — no stdout, no file, no logger. Same rule as the SMS sender
 * (M1-06 §6): a message body here holds somebody's name and the umcimbi they
 * contributed to, and "it is only development" is how that ends up in an
 * aggregator.
 *
 * Playwright reads it through `/dev/messages`, which 404s in production.
 *
 * **No BSP has been chosen** (implementation-plan Part J item 3), so this is
 * the only implementation. Production does not fall back to it — `whatsAppSender()`
 * throws — because a notification that silently goes nowhere is worse than one
 * that fails loudly on the machine that was meant to send it.
 */

export interface SentWhatsApp extends WhatsAppTemplateMessage {
  readonly sentAt: Date
}

/**
 * On `globalThis` so the store survives Next's module reloading in development
 * — two copies of this module would mean the dev route reading an empty array
 * while the flush wrote to the other one.
 */
const store: SentWhatsApp[] = ((
  globalThis as Record<string, unknown>
).__isiphekoWhatsApp ??= []) as SentWhatsApp[]

export class InMemoryWhatsAppSender implements WhatsAppSender {
  send(message: WhatsAppTemplateMessage): Promise<void> {
    store.push({ ...message, sentAt: new Date() })

    return Promise.resolve()
  }
}

/** Development and test only. There is no production caller. */
export function sentWhatsApp(): readonly SentWhatsApp[] {
  return store
}

export function whatsAppTo(phoneE164: string): readonly SentWhatsApp[] {
  return store.filter((message) => message.to === phoneE164)
}

export function clearWhatsAppStore(): void {
  store.length = 0
}
