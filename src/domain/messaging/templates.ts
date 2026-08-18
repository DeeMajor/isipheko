/**
 * The message templates, as data.
 *
 * **Every one of these is a utility template and none of them may become a
 * marketing template.** Category is assigned in Meta Business Manager and
 * decides the rate: utility and authentication are cheap, marketing is around
 * $0.086 (~R1.50) a send in South Africa — and a template carrying anything
 * promotional gets *reclassified*, without asking. Architecture §8.1 makes that
 * a design consequence rather than a preference, so the category is declared
 * here beside the words and a test refuses both a non-utility category and the
 * vocabulary that causes a reclassification.
 *
 * **No template body lives in this file.** The words are copy (rule 11) and
 * live in `src/copy/notifications.ts`, keyed by archetype where the register
 * differs — a funeral digest does not say "helped". What lives here is what
 * Meta needs: the registered name, the language, the category, and the ordered
 * parameters that fill `{{1}}`, `{{2}}`, `{{3}}`.
 *
 * **The payout rows of architecture §8.2 are deliberately absent.** Mode B is
 * gated on the legal opinion (§15 item 1), so those messages cannot be sent or
 * tested. A template that looks reviewed and has never been exercised is worse
 * than an obvious gap; they slot in here when M5 can fire them.
 */

export type TemplateId =
  | 'organiser_digest'
  | 'contributor_contribution_confirmed'
  | 'contributor_claim_confirmed'
  | 'contributor_claim_expiring'
  | 'reporter_report_received'

/**
 * Meta's categories. Only one of them is ever correct here, and the type says
 * so — a marketing template cannot be declared without editing this line, which
 * is the point.
 */
export type TemplateCategory = 'utility'

export interface NotificationTemplate {
  readonly id: TemplateId
  /** The name registered in Meta Business Manager. Snake case, versioned. */
  readonly metaName: string
  readonly category: TemplateCategory
  /** BCP-47. English only at launch — see `src/copy/share.ts` and Part D. */
  readonly language: 'en'
  /**
   * Ordered, and the order **is** the wire format: Meta fills `{{1}}` with the
   * first. Renaming one is free; reordering one silently rewrites every message
   * that uses it, so the names are here to be read next to the copy.
   */
  readonly params: readonly string[]
}

export const TEMPLATES = {
  organiser_digest: {
    id: 'organiser_digest',
    metaName: 'organiser_digest_v1',
    category: 'utility',
    language: 'en',
    params: ['eventTitle', 'summary', 'url'],
  },

  /*
   * `confirmation` is a parameter rather than fixed body text because the
   * register differs by archetype — a funeral says "the record of who stood
   * with them", a wedding says "your bead is on the strand" — and one
   * registered template with a parameter beats two templates that have to be
   * kept in step inside somebody else's console.
   */
  contributor_contribution_confirmed: {
    id: 'contributor_contribution_confirmed',
    metaName: 'contribution_confirmed_v1',
    category: 'utility',
    language: 'en',
    params: ['eventTitle', 'confirmation', 'url'],
  },

  contributor_claim_confirmed: {
    id: 'contributor_claim_confirmed',
    metaName: 'claim_confirmed_v1',
    category: 'utility',
    language: 'en',
    params: ['item', 'eventTitle', 'url'],
  },

  /**
   * The acknowledgement somebody who reported a page gets (M3-06).
   *
   * Utility, and unmistakably so: it confirms a thing the person did and tells
   * them when to expect a person. It carries no link to the page reported and
   * nothing about it — somebody may be reporting their own family.
   *
   * **It cannot be sent yet**, because no BSP exists (Part J item 3). It sits in
   * the outbox, which is what the outbox is for. The acknowledgement that
   * actually arrives today is the reference on screen.
   */
  reporter_report_received: {
    id: 'reporter_report_received',
    metaName: 'report_received_v1',
    category: 'utility',
    language: 'en',
    params: ['reference', 'respondBy'],
  },

  contributor_claim_expiring: {
    id: 'contributor_claim_expiring',
    metaName: 'claim_expiring_v1',
    category: 'utility',
    language: 'en',
    params: ['item', 'eventTitle', 'url'],
  },
} as const satisfies Record<TemplateId, NotificationTemplate>

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as readonly TemplateId[]

export function templateFor(id: TemplateId): NotificationTemplate {
  return TEMPLATES[id]
}

export function isTemplateId(value: string): value is TemplateId {
  return value in TEMPLATES
}

/**
 * The parameters a message carries, by name rather than by position.
 *
 * Positional arrays are what goes on the wire; a record is what code should
 * hold, because `params[2]` in a repository is how the item and the event title
 * end up the wrong way round in somebody's WhatsApp.
 */
export type TemplateParams = Readonly<Record<string, string>>

/** The positional array Meta wants, built from the registry's declared order. */
export function orderParams(id: TemplateId, params: TemplateParams): readonly string[] {
  return templateFor(id).params.map((name) => params[name] ?? '')
}

/** True when every declared parameter has a value. */
export function hasAllParams(id: TemplateId, params: TemplateParams): boolean {
  return templateFor(id).params.every((name) => (params[name] ?? '') !== '')
}
