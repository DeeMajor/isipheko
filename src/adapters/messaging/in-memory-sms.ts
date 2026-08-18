import type { SmsMessage, SmsSender } from '../../domain/messaging/index.ts'

/**
 * The development and test sender. It holds the last message per number in
 * memory and **writes nothing anywhere** — not to stdout, not to a file, not to
 * a logger.
 *
 * Printing the code in development is what every OTP tutorial does, and it is
 * how codes leak: development logs end up in aggregators, in screen shares, and
 * pasted into issues. The done-criteria for M1-06 say no OTP appears in any
 * log, and "it is only development" is not an exception to that.
 *
 * Playwright reads the code through `/dev/sms`, which 404s in production
 * exactly like `/dev/tokens`.
 */

interface SentMessage {
  readonly to: string
  readonly body: string
  readonly sentAt: Date
}

/**
 * On `globalThis` so the store survives Next's module reloading in dev — two
 * copies of this module would mean the route handler reading an empty map while
 * the action wrote to the other one.
 */
const store: Map<string, SentMessage> = ((
  globalThis as Record<string, unknown>
).__isiphekoSms ??= new Map<string, SentMessage>()) as Map<string, SentMessage>

export class InMemorySmsSender implements SmsSender {
  send(message: SmsMessage): Promise<void> {
    store.set(message.to, { ...message, sentAt: new Date() })
    return Promise.resolve()
  }
}

/** Development and test only. There is no production caller. */
export function lastSmsTo(phoneE164: string): SentMessage | undefined {
  return store.get(phoneE164)
}

export function clearSmsStore(): void {
  store.clear()
}
