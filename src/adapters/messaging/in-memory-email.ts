import type { EmailMessage, EmailSender } from '../../domain/messaging/index.ts'

/**
 * The development and test email sender. Holds messages in memory and writes
 * nothing anywhere, for the same reason as its WhatsApp and SMS siblings.
 *
 * No email provider has been chosen. Architecture §3 wants one processing in
 * the EU or South Africa (POPIA §72); until then production refuses to
 * construct a sender rather than dropping a fallback message quietly.
 */

export interface SentEmail extends EmailMessage {
  readonly sentAt: Date
}

const store: SentEmail[] = ((globalThis as Record<string, unknown>).__isiphekoEmail ??=
  []) as SentEmail[]

export class InMemoryEmailSender implements EmailSender {
  send(message: EmailMessage): Promise<void> {
    store.push({ ...message, sentAt: new Date() })

    return Promise.resolve()
  }
}

/** Development and test only. There is no production caller. */
export function sentEmail(): readonly SentEmail[] {
  return store
}

export function emailTo(address: string): readonly SentEmail[] {
  return store.filter((message) => message.to === address)
}

export function clearEmailStore(): void {
  store.length = 0
}
