// Relative with explicit extensions: `scripts/notify.ts` loads this under
// plain Node, which resolves no tsconfig aliases (docs/decisions.md M2-01 §8).
import type {
  EmailSender,
  SmsSender,
  WhatsAppSender,
} from '../../domain/messaging/index.ts'

import { InMemoryEmailSender } from './in-memory-email.ts'
import { InMemorySmsSender } from './in-memory-sms.ts'
import { InMemoryWhatsAppSender } from './in-memory-whatsapp.ts'

export { InMemorySmsSender, clearSmsStore, lastSmsTo } from './in-memory-sms.ts'

export {
  type SentWhatsApp,
  InMemoryWhatsAppSender,
  clearWhatsAppStore,
  sentWhatsApp,
  whatsAppTo,
} from './in-memory-whatsapp.ts'

export {
  type SentEmail,
  InMemoryEmailSender,
  clearEmailStore,
  emailTo,
  sentEmail,
} from './in-memory-email.ts'

/**
 * The three senders, and the same posture for all of them: **no provider has
 * been chosen, and production refuses rather than pretending.**
 *
 * A sender that silently delivers nothing is worse than a missing one. An
 * organiser who is never told somebody paid, or a contributor left waiting for
 * a confirmation that was written to an array in memory, has no way to know
 * anything went wrong — and neither do we. Failing at the point of the missing
 * configuration is the only honest option until an adapter exists.
 *
 * `scripts/notify.ts` therefore stops on the first flush in an unconfigured
 * production, loudly. That is the intended behaviour, not an oversight: the
 * outbox keeps the messages, and nothing is lost by the flush refusing to run.
 */

export function smsSender(nodeEnv: string | undefined): SmsSender {
  if (nodeEnv === 'production') {
    throw new Error(
      'No SMS provider is configured. Choose one, add the adapter, and wire it here — ' +
        'do not fall back to the in-memory sender, which delivers nothing.',
    )
  }

  return new InMemorySmsSender()
}

export function whatsAppSender(nodeEnv: string | undefined): WhatsAppSender {
  if (nodeEnv === 'production') {
    throw new Error(
      'No WhatsApp BSP is configured (implementation-plan Part J item 3). Choose one, ' +
        'register the utility templates in src/domain/messaging/templates.ts, add the ' +
        'adapter, and wire it here — do not fall back to the in-memory sender.',
    )
  }

  return new InMemoryWhatsAppSender()
}

export function emailSender(nodeEnv: string | undefined): EmailSender {
  if (nodeEnv === 'production') {
    throw new Error(
      'No email provider is configured. Architecture §3 wants one processing in the EU ' +
        'or South Africa — choose it, add the adapter, and wire it here.',
    )
  }

  return new InMemoryEmailSender()
}
