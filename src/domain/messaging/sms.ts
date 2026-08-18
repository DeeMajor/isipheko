/**
 * The contract for sending an SMS. The `PaymentProvider` pattern (§5.1): the
 * interface lives in domain/, the implementations live in adapters/, and no
 * domain or app code knows which provider is behind it.
 *
 * **SMS, not WhatsApp, for one-time codes.** South Africa sits on Meta's
 * authentication-international tier, where the rate is significantly higher
 * than the utility rate — architecture §8.1 makes this an explicit design
 * consequence, not a preference. Notifications go over WhatsApp; codes do not.
 *
 * No provider has been chosen yet, and none is in the open-items list. The
 * interface is deliberately small so that choosing one is an adapter and a
 * credential rather than a change to the sign-in flow.
 */

export interface SmsMessage {
  /** E.164. Normalise before you get here. */
  readonly to: string
  readonly body: string
}

export interface SmsSender {
  send(message: SmsMessage): Promise<void>
}
