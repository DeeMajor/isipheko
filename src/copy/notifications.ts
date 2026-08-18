import type { ArchetypeKey } from '../domain/archetype/index.ts'
import type { DigestCounts, TemplateId } from '../domain/messaging/index.ts'

/**
 * What a notification says.
 *
 * Rule 11: the words are here and not in the template registry, which holds
 * what Meta needs — the registered name, the category, the parameter order.
 *
 * **English only**, like the rest of `src/copy/` (see `share.ts` and Part D).
 * The registered Meta templates carry the same English text with `{{1}}`,
 * `{{2}}`, `{{3}}` in the positions the registry declares, so these previews
 * are what the person actually receives — which is why the tests read them.
 *
 * Two rules the words obey:
 *
 * **Nothing promotional, ever.** A utility template carrying anything that
 * reads as marketing is reclassified by Meta and costs roughly seventeen times
 * more (§8.1). No "click here", no "don't miss", no invitation to do anything
 * except the thing that just happened.
 *
 * **No amounts and no totals.** A digest is read on a lock screen and forwarded
 * without thinking; the organiser sees every amount on their own screen. On a
 * bereavement event, amounts are hidden by default and a notification is not
 * the place to undo that.
 */

/** Plural without a library: "1 person" / "3 people". */
function people(count: number): string {
  return count === 1 ? '1 person' : `${String(count)} people`
}

export interface ArchetypeNotificationCopy {
  /** The line summarising an hour, in the register the umcimbi calls for. */
  readonly digestSummary: (counts: DigestCounts) => string
  /** What the confirmation to a contributor says the record now holds. */
  readonly contributionConfirmed: (eventTitle: string) => string
}

function celebratorySummary(counts: DigestCounts): string {
  const parts: string[] = []

  if (counts.selfReported > 0) parts.push(`${people(counts.selfReported)} said they paid`)
  if (counts.confirmed > 0) parts.push(`${people(counts.confirmed)} were confirmed`)
  if (counts.claimed > 0) parts.push(`${people(counts.claimed)} are bringing something`)

  return parts.join(', ')
}

/**
 * Bereavement says "stood with" rather than "helped", and never invites
 * anybody to a day. Same distinction the share message makes.
 */
function bereavementSummary(counts: DigestCounts): string {
  const parts: string[] = []

  if (counts.selfReported > 0) parts.push(`${people(counts.selfReported)} said they paid`)
  if (counts.confirmed > 0) {
    parts.push(`${people(counts.confirmed)} were confirmed on the record`)
  }
  if (counts.claimed > 0) parts.push(`${people(counts.claimed)} are bringing something`)

  return parts.join(', ')
}

const CELEBRATORY: ArchetypeNotificationCopy = {
  digestSummary: celebratorySummary,
  contributionConfirmed: (eventTitle) =>
    `Your contribution to ${eventTitle} has been confirmed by the family. Your bead is on the strand.`,
}

const BEREAVEMENT: ArchetypeNotificationCopy = {
  digestSummary: bereavementSummary,
  contributionConfirmed: (eventTitle) =>
    `Your contribution to ${eventTitle} has been confirmed by the family. Your name is on the record of who stood with them.`,
}

export const archetypeNotificationCopy: Record<ArchetypeKey, ArchetypeNotificationCopy> =
  {
    umshado: CELEBRATORY,
    umembeso: CELEBRATORY,
    umngcwabo: BEREAVEMENT,
    umbuyiso: BEREAVEMENT,
    imbeleko: CELEBRATORY,
    graduation: CELEBRATORY,
    itiye: CELEBRATORY,
  }

/**
 * The template bodies, as they read when filled.
 *
 * Each takes the same named parameters the registry declares for its template,
 * so a body and its registration cannot drift apart without a test noticing.
 */
export const notificationCopy: Record<
  TemplateId,
  (params: Record<string, string>) => string
> = {
  organiser_digest: (params) =>
    `Isipheko: an update on ${params.eventTitle ?? ''}. ${params.summary ?? ''}. Open ${params.url ?? ''} to see the record.`,

  contributor_contribution_confirmed: (params) =>
    `Isipheko: ${params.eventTitle ?? ''}. ${params.confirmation ?? ''} See it at ${params.url ?? ''}.`,

  /**
   * No link, no event title, no organiser name. Somebody may be reporting their
   * own family, and a message quoting the page back at them could be read over
   * their shoulder.
   */
  reporter_report_received: (params) =>
    `Isipheko: we have your report, reference ${params.reference ?? ''}. A person will have looked at it by ${params.respondBy ?? ''}. We will never ask you for a code.`,

  contributor_claim_confirmed: (params) =>
    `Isipheko: you have said you will bring ${params.item ?? ''} for ${params.eventTitle ?? ''}. The family can see it is coming. Open ${params.url ?? ''} if that changes.`,

  contributor_claim_expiring: (params) =>
    `Isipheko: your hold on ${params.item ?? ''} for ${params.eventTitle ?? ''} runs out in two days. If you can still bring it, nothing is needed. If you cannot, open ${params.url ?? ''} so somebody else can.`,
}

export const notificationSubjects: Record<
  TemplateId,
  (params: Record<string, string>) => string
> = {
  organiser_digest: (params) => `An update on ${params.eventTitle ?? ''}`,
  contributor_contribution_confirmed: (params) =>
    `Your contribution to ${params.eventTitle ?? ''}`,
  /**
   * No link, no event title, no organiser name. Somebody may be reporting their
   * own family, and a message quoting the page back at them could be read over
   * their shoulder.
   */
  reporter_report_received: (params) =>
    `Isipheko: we have your report, reference ${params.reference ?? ''}. A person will have looked at it by ${params.respondBy ?? ''}. We will never ask you for a code.`,

  contributor_claim_confirmed: (params) =>
    `What you are bringing to ${params.eventTitle ?? ''}`,
  contributor_claim_expiring: (params) => `Your hold on ${params.item ?? ''}`,
}
