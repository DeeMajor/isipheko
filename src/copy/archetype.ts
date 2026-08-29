import type { ArchetypeKey } from '@/domain/archetype/config'

/**
 * The user-facing words on an archetype (M1-10).
 *
 * ## Why these moved
 *
 * They were in `src/domain/archetype/archetypes.ts`, and that file said so:
 * *"These are user-facing strings in `src/domain/`, which sits awkwardly against
 * rule 11 … see docs/decisions.md M1-04 for where they go when `src/copy/`
 * lands."* M1-04 §7 is more specific still — **"when `src/copy/` lands, they
 * should move there and the config should reference them: the flags stay, the
 * sentences go."**
 *
 * `src/copy/` landed at M2-05. They did not move. Seven isiZulu ceremony names
 * and every consequence sentence sat outside the translation unit, which means
 * a translation pass keyed on `src/copy/` would have missed the words a
 * bereaved family reads first (docs/remaining-work.md F.3).
 *
 * ## What did not move
 *
 * **The flags.** `amountsPublic`, `allowsTarget`, `animate` and the rest are
 * business rules and stay in `src/domain/`, where the bereavement guards can
 * reach them. What is here is only the words, and `consequencesFor` still
 * composes them from the flags rather than writing four sentences seven times.
 *
 * That composition is not the conditional rule 2 forbids: nothing here asks
 * *which archetype it is*, only what the archetype permits.
 */

/** "Umngcwabo", "Umshado" — the word for this kind of umcimbi. */
export interface ArchetypeWords {
  readonly kicker: string
  /** "Stand with them" · "Contribute". An action keeps its name through the flow. */
  readonly verb: string
}

/**
 * **Every one of these needs a first-language reader** (Part J item 9,
 * docs/remaining-work.md F.3). Nobody who speaks isiZulu has checked them, and
 * two are open questions rather than settled words:
 *
 * - **`Umgidi` for a graduation.** Nothing in `docs/` records why it was chosen.
 * - **`Itiye` for a gathering.** `design/setup.html` and `design/collection.html`
 *   both say `Umhlangano`. One of them is wrong and the disagreement is
 *   unrecorded anywhere.
 *
 * They are named here rather than only in a document because this is the file
 * somebody doing that review opens.
 */
export const archetypeWords: Record<ArchetypeKey, ArchetypeWords> = {
  umshado: { kicker: 'Umshado', verb: 'Contribute' },
  umembeso: { kicker: 'Umembeso', verb: 'Contribute' },
  umngcwabo: { kicker: 'Umngcwabo', verb: 'Stand with them' },
  umbuyiso: { kicker: 'Umbuyiso', verb: 'Stand with them' },
  imbeleko: { kicker: 'Imbeleko', verb: 'Contribute' },
  graduation: { kicker: 'Umgidi', verb: 'Contribute' },
  itiye: { kicker: 'Itiye', verb: 'Contribute' },
}

/**
 * The four consequences shown at the kind step, taken verbatim from
 * `design/setup.html`.
 *
 * The organiser is told what choosing a funeral will mean **before** she
 * chooses, rather than discovering on a published page that targets, amounts
 * and motion have quietly gone. Composed from the flags by
 * `consequencesFor`; the pairs are here.
 */
export const consequenceWords = {
  amounts: {
    shown: {
      label: 'Amounts are shown.',
      detail:
        "Each person's name and what they gave appears on the strand, unless they choose to give quietly.",
    },
    hidden: {
      label: 'Amounts are hidden.',
      detail: 'Only the family sees who gave what. Names are shown, amounts are not.',
    },
  },
  target: {
    shown: {
      label: 'A target is shown.',
      detail: 'You can set a figure and people see how far along it is.',
    },
    hidden: {
      label: 'No target is shown.',
      detail: 'There is no figure to fall short of. People give what they can.',
    },
  },
  motion: {
    shown: {
      label: 'A little celebration.',
      detail: 'A new bead settles onto the strand when someone contributes.',
    },
    hidden: {
      label: 'No animation.',
      detail: 'Beads simply appear. Nothing on the page moves.',
    },
  },
  words: {
    label: 'The words change.',
    public: '“Contribute”, and “who has contributed”.',
    private: '“Stand with them”, and “who has stood with the family”.',
  },
} as const
