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

  /**
   * A message and a photograph on the thing she is bringing (M4-02b).
   *
   * Somebody bringing the tent — the most substantial thing anyone does, and the
   * thing the product is named for — could leave neither, ever. The album
   * therefore under-represented exactly the contribution *ukupheka* describes,
   * while somebody sending R50 could write whatever they liked.
   *
   * **Asked here because here is the only place she is.** An in-kind
   * contribution's row is not created until the organiser confirms delivery,
   * hours or days later, so this is the last and only moment the person with
   * something to say is on the page.
   *
   * Both optional, and the copy does not press. Somebody bringing chairs who
   * writes nothing has still brought the chairs.
   */
  messageLabel: 'Anything you want to say',
  messageHelp:
    'It goes on the record beside your name, for the family to read. Leave it blank if you would rather not.',
  messagePlaceholder: '',

  photoLabel: 'A photograph, if you have one',
  photoHelp:
    'We strip where and when it was taken before storing it, so a picture taken at your house does not carry your address with it.',

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
    /**
     * Its own sentence (UX-11): a missing name used to answer with
     * "Choose at least one", the quantity error, about a different field.
     */
    'no-name': 'Enter the name the family should see, and claim it again.',
    'not-a-whole-number': 'Whole numbers only.',
    conflict: 'Somebody else got there first.',
    'too-many-requests':
      'That is a lot of claims from one place. Wait a few minutes and try again.',
    'cross-site': 'That request did not come from this page.',
  },

  /**
   * The claim held; the photo did not (UX-11).
   *
   * A rejected photograph deliberately does not stop the claim — somebody
   * bringing the tent is bringing the tent whatever their camera produced
   * (M4-02b §4) — but silence about it left the person believing the photo
   * was on the record. Each says what happened and the one honest way to a
   * photo: undo inside the window and claim again, because a claim cannot
   * take a photo afterwards.
   */
  photoRejected: {
    empty: 'Your photo did not come through, so the claim stands without it.',
    'too-big': 'Your photo is over 8MB, so the claim stands without it.',
    heic: 'Your photo is an iPhone format we cannot read, so the claim stands without it. Sending it through WhatsApp or Photos first turns it into a JPEG.',
    'not-an-image':
      'That file is not a photo we can read, so the claim stands without it.',
    unreadable:
      'Your photo did not come through in one piece, so the claim stands without it.',
  },
  photoRejectedNext:
    'To put a photo on it, tap Undo while the seconds are still counting and claim again with a different one.',
} as const
