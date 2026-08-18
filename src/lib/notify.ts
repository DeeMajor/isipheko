// Relative imports with explicit extensions, like the repositories: this
// module is loaded by `scripts/notify.ts` under plain Node, which resolves no
// tsconfig aliases (docs/decisions.md M2-01 §8).
import { emailSender, smsSender, whatsAppSender } from '../adapters/messaging/index.ts'
import {
  archetypeNotificationCopy,
  notificationCopy,
  notificationSubjects,
} from '../copy/notifications.ts'
import type { PrismaClient } from '../db/generated/client.ts'
import {
  buildDigest,
  dueNotifications,
  markFailed,
  markSent,
  pendingDigests,
  type DueNotification,
} from '../db/repositories/notifications.ts'
// Straight at the module rather than the barrel: `src/domain/archetype/index.ts`
// re-exports values without file extensions, which plain Node cannot resolve,
// and `archetypes.ts` imports its own types type-only so nothing else is needed
// at runtime.
import { ARCHETYPES } from '../domain/archetype/archetypes.ts'
import type { ArchetypeKey } from '../domain/archetype/config.ts'
import {
  isTemplateId,
  orderParams,
  templateFor,
  type TemplateId,
} from '../domain/messaging/index.ts'

/**
 * The flush: build the digests that are due, then send what is due.
 *
 * It lives here rather than in `scripts/notify.ts` so it can be tested against
 * a real database without spawning a process, and so BullMQ can call exactly
 * this function later without the script becoming the thing that has to be
 * ported.
 *
 * **This is the only place copy and delivery meet.** Repositories store the
 * template and its parameters (rule 11 keeps prose out of `db/`); this renders
 * the parameters into the words the person receives, and hands them to whichever
 * adapter the channel names.
 */

/**
 * Where a link in a message points.
 *
 * Read from the environment rather than from `src/lib/env.ts`, which cannot be
 * loaded here: `scripts/notify.ts` runs under Node's strip-only TypeScript, and
 * the env module uses a parameter property that mode refuses. The default
 * mirrors the one documented there, and production sets the variable or refuses
 * to boot at all (M1-01 §7).
 */
const DEFAULT_APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/** How the words are filled in for a message about to go out. */
function renderParams(
  notification: DueNotification,
  appUrl: string,
): Record<string, string> {
  const params = { ...notification.params }
  const slug = params.slug ?? ''

  if (slug !== '') {
    params.url = `${appUrl}/e/${slug}`
  }

  const archetype = params.archetype
  const config =
    archetype !== undefined && archetype in ARCHETYPES
      ? archetypeNotificationCopy[archetype as ArchetypeKey]
      : null

  if (notification.templateId === 'organiser_digest') {
    const selfReported = Number(params.selfReported ?? '0')
    const confirmed = Number(params.confirmed ?? '0')
    const claimed = Number(params.claimed ?? '0')

    params.summary =
      config?.digestSummary({
        selfReported,
        confirmed,
        claimed,
        total: selfReported + confirmed + claimed,
      }) ?? ''
  }

  if (notification.templateId === 'contributor_contribution_confirmed') {
    params.confirmation = config?.contributionConfirmed(params.eventTitle ?? '') ?? ''
  }

  return params
}

export interface FlushReport {
  /** Digests built. One per organiser per umcimbi, at most one an hour. */
  readonly digests: number
  /** Facts those digests summarised — the number that did **not** become messages. */
  readonly summarised: number
  readonly sent: number
  readonly retrying: number
  readonly failed: number
}

export interface FlushOptions {
  readonly now?: Date
  readonly limit?: number
  readonly nodeEnv?: string | undefined
  readonly appUrl?: string
}

export async function flushNotifications(
  db: PrismaClient,
  {
    now = new Date(),
    limit = 100,
    nodeEnv = process.env.NODE_ENV,
    appUrl = DEFAULT_APP_URL,
  }: FlushOptions = {},
): Promise<FlushReport> {
  let digests = 0
  let summarised = 0

  for (const pending of await pendingDigests(db)) {
    const outcome = await buildDigest(db, { ...pending, now })

    if (outcome.created) {
      digests += 1
      summarised += outcome.entries
    }
  }

  const whatsapp = whatsAppSender(nodeEnv)
  const email = emailSender(nodeEnv)
  const sms = smsSender(nodeEnv)

  let sent = 0
  let retrying = 0
  let failed = 0

  for (const notification of await dueNotifications(db, { now, limit })) {
    if (!isTemplateId(notification.templateId)) {
      // A template that no longer exists in the registry. Failing it is
      // correct: sending an unregistered template name is rejected by Meta
      // anyway, and retrying it forever is worse than one dead row.
      await markFailed(db, { id: notification.id, errorCode: 'unknown-template', now })
      failed += 1
      continue
    }

    const templateId: TemplateId = notification.templateId
    const template = templateFor(templateId)
    const params = renderParams(notification, appUrl)
    const body = notificationCopy[templateId](params)

    try {
      if (notification.channel === 'whatsapp' && notification.toPhoneE164 !== null) {
        await whatsapp.send({
          to: notification.toPhoneE164,
          template: templateId,
          metaName: template.metaName,
          language: template.language,
          params: orderParams(templateId, params),
        })
      } else if (notification.channel === 'email' && notification.toEmail !== null) {
        await email.send({
          to: notification.toEmail,
          subject: notificationSubjects[templateId](params),
          body,
        })
      } else if (notification.channel === 'sms' && notification.toPhoneE164 !== null) {
        // Nothing routes here today: SMS is for one-time codes, which do not go
        // through the outbox. It exists so that the day a payout reversal needs
        // SMS as well as WhatsApp (§8.2), the channel is not a new concept.
        await sms.send({ to: notification.toPhoneE164, body })
      } else {
        await markFailed(db, { id: notification.id, errorCode: 'no-recipient', now })
        failed += 1
        continue
      }

      if (await markSent(db, { id: notification.id, now })) sent += 1
    } catch (error) {
      // A code, never the provider's prose: it can carry the recipient's
      // number, and this ends up in logs (rule 8).
      const code = error instanceof Error ? error.name : 'send-failed'
      const outcome = await markFailed(db, { id: notification.id, errorCode: code, now })

      if (outcome.status === 'pending') retrying += 1
      else failed += 1
    }
  }

  return { digests, summarised, sent, retrying, failed }
}
