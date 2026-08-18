export type { SmsMessage, SmsSender } from './sms.ts'

export type { EmailMessage, EmailSender } from './email.ts'

export type { WhatsAppSender, WhatsAppTemplateMessage } from './whatsapp.ts'

export {
  type NotificationTemplate,
  type TemplateCategory,
  type TemplateId,
  type TemplateParams,
  TEMPLATES,
  TEMPLATE_IDS,
  hasAllParams,
  isTemplateId,
  orderParams,
  templateFor,
} from './templates.ts'

export {
  type DigestCounts,
  type DigestEntryKind,
  type NotificationChannel,
  type NotificationKind,
  type Recipient,
  DIGEST_INTERVAL_MS,
  MAX_ATTEMPTS,
  QUIET_HOURS_END,
  QUIET_HOURS_START,
  SAST_OFFSET_MINUTES,
  attemptsExhausted,
  channelFor,
  countDigest,
  digestDue,
  digestDueAt,
  nextAttemptAt,
  nextSendWindow,
  sastHour,
  withinSendWindow,
} from './notification.ts'
