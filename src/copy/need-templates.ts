import type { ArchetypeKey, NeedTemplateId } from '@/domain/archetype'

/**
 * What a family usually needs, per archetype, taken verbatim from
 * `KINDS[].needs` in `design/setup.html`.
 *
 * **A template is static application data, not a database entity.** M1-04's
 * note said these would be seed rows in M2; that was wrong, and there is no
 * `need_templates` table because there should not be one. A template seeds a
 * new event's `need_items` at creation and then has no further existence — the
 * organiser owns the list from that moment, and editing it must not change
 * anybody else's.
 *
 * They are user-facing strings, so they live in `src/copy/` (CLAUDE.md rule 11)
 * and are a translation unit like everything else here.
 *
 * The point of pre-filling is in the copy on the needs step: *"You do not have
 * to think of it all yourself."* A grieving family should not be handed an
 * empty list. Every row is editable and removable, and the screen marks which
 * ones we suggested.
 */

export interface NeedTemplateItem {
  readonly label: string
  /** Free text. See the note column in `need_items` — never parsed. */
  readonly note: string
}

const UNION: readonly NeedTemplateItem[] = [
  { label: 'Marquee', note: 'Around R6 500 to hire' },
  { label: 'Catering', note: 'For 200 people' },
  { label: 'Cattle', note: '2 head' },
  { label: 'Décor', note: 'Fabric, flowers, table settings' },
  { label: 'Transport', note: 'One bus from Durban' },
  { label: 'Photographer', note: 'For the day' },
]

const TEMPLATES: Record<ArchetypeKey, readonly NeedTemplateItem[]> = {
  umshado: UNION,

  // The prototype has no umembeso entry. Same group as umshado and the same
  // register, so it takes the same list until somebody writes a better one.
  umembeso: UNION,

  umngcwabo: [
    { label: 'Tent', note: 'Around R1 200 to hire' },
    { label: 'Chairs', note: '100 chairs' },
    { label: 'Meat', note: '20kg' },
    { label: 'Groceries', note: 'Mealie meal, rice, sugar, oil' },
    { label: 'Transport', note: 'One bakkie or a shared taxi' },
    { label: 'Catering pots', note: 'Big pots and serving dishes' },
  ],

  umbuyiso: [
    { label: 'Tombstone', note: 'The balance still owing' },
    { label: 'Tent', note: 'Around R1 200 to hire' },
    { label: 'Chairs', note: '60 chairs' },
    { label: 'Meat', note: 'A goat' },
    { label: 'Groceries', note: 'For the meal after' },
    { label: 'Transport', note: 'For family travelling' },
  ],

  imbeleko: [
    { label: 'A goat', note: 'For the ceremony' },
    { label: 'Groceries', note: 'For the meal' },
    { label: 'Chairs', note: '40 chairs' },
    { label: 'Blankets', note: 'For the child' },
    { label: 'Nappies and clothes', note: 'Newborn size' },
    { label: 'Transport', note: 'For elders attending' },
  ],

  graduation: [
    { label: 'Venue or gazebo', note: 'Around R2 000' },
    { label: 'Catering', note: 'For 80 people' },
    { label: 'Cooldrink and water', note: '20 crates' },
    { label: 'Cake', note: 'One large cake' },
    { label: 'Sound and music', note: 'For the afternoon' },
    { label: 'Chairs and tables', note: '80 chairs' },
  ],

  itiye: [
    { label: 'Venue or hall', note: 'Around R1 500' },
    { label: 'Catering', note: 'For 60 people' },
    { label: 'Cooldrink and water', note: '12 crates' },
    { label: 'Chairs and tables', note: '60 chairs' },
    { label: 'Transport', note: 'For those travelling far' },
    { label: 'Firewood', note: 'Enough for the day' },
  ],
}

/**
 * Looked up by the versioned id on the archetype config, so a template cannot
 * be fetched for an archetype that does not name one.
 */
export function needTemplate(id: NeedTemplateId): readonly NeedTemplateItem[] {
  const key = id.split('@')[0] as ArchetypeKey
  return TEMPLATES[key]
}
