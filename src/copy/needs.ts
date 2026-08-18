/**
 * The needs board, on the public page. Strings from `design/event.html`
 * (CLAUDE.md rule 11).
 *
 * An action keeps its name through the flow: "Claim the tent" produces "You've
 * claimed the tent." The verb does not become "reserve" halfway.
 */
export const needsCopy = {
  claim: (noun: string) => `I'll bring the ${noun}`,
  claimPart: (noun: string) => `I'll bring some of the ${noun}`,
  claimed: (noun: string) => `You've claimed the ${noun}`,
  claimedBody:
    'It is held for you. Nobody else can claim it, and the family can see it is coming.',

  quantityLabel: 'How many',
  quantityHelp: (remaining: number, unit: string) =>
    `${String(remaining)}${unit} still needed. Take as much or as little as you can.`,

  /**
   * Said before the name is typed, because confirming delivery now puts that
   * name on the strand (M2-06). Somebody should know that before they give it,
   * not discover it on a page fifty people have.
   */
  nameLabel: 'Your name',
  nameHelp: 'Your name goes on the strand once the family confirms it arrived.',

  held: 'Held',
  heldBy: (name: string) => `${name} is bringing this`,
  allTaken: 'All of this is taken',

  remaining: (remaining: number, required: number, unit: string) =>
    `${String(remaining)} of ${String(required)}${unit} still needed`,

  undo: 'Undo',
  undoWindow: (seconds: number) => `Undo (${String(seconds)}s)`,
  undoneTitle: 'Put back on the list',
  undoneBody: 'Nothing is held for you. Somebody else can take it now.',

  /**
   * The conflict branch. Never phrased as a failure on the contributor's part —
   * they did nothing wrong, somebody was simply a second quicker.
   */
  conflictTitle: (noun: string) => `Somebody else got the ${noun} first`,
  conflictBody:
    'Nothing is needed here now. You can take something else from this list, or put money toward the day instead.',

  tooLateTitle: 'That claim is no longer yours to undo',
  tooLateBody:
    'The fifteen seconds have passed. Ask the family to release it if you can no longer bring it.',

  errors: {
    'not-open': 'That is not on the list any more.',
    'already-taken': 'All of this is taken.',
    'more-than-remains': 'That is more than is still needed. Try a smaller amount.',
    'all-or-nothing': 'This one is all or nothing.',
    'at-least-one': 'Choose at least one.',
    'not-a-whole-number': 'Whole numbers only.',
    conflict: 'Somebody else got there first.',
    'too-many-requests':
      'That is a lot of claims from one place. Wait a few minutes and try again.',
    'cross-site': 'That request did not come from this page.',
  },
} as const
