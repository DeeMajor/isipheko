import { needsCopy } from '@/copy/needs'

/**
 * The needs board, as forms.
 *
 * The public page is a route handler with no client runtime (M1-08), so every
 * action here is a `<form method="post">` that works with JavaScript disabled —
 * which is what CLAUDE.md rule 5 has always required. `public/needs-board.js`
 * enhances these forms; it does not implement them.
 *
 * **Nothing here is optimistic.** A claim button posts and waits. The `claimed`
 * and `conflict` states are rendered by the server after the reservation has
 * either happened or not, because two people tapping "I'll bring the tent" in
 * the same second must not both see success.
 */

export interface BoardItem {
  readonly id: string
  readonly label: string
  /** "the tent", "the chairs" — the noun as it appears in a sentence. */
  readonly noun: string
  readonly note: string | null
  readonly quantityRequired: number
  readonly quantityClaimed: number
  readonly remaining: number
  readonly unit: string
  readonly allowsPartialClaim: boolean
}

export type ItemOutcome =
  | {
      readonly kind: 'claimed'
      readonly itemId: string
      readonly secondsLeft: number
      /**
       * Set when the photo was rejected while the claim went through (UX-11).
       * A rejection does not stop the claim (M4-02b §4), but silence about it
       * read as "photo attached" — the panel says what happened while the
       * undo seconds, the one honest way to a photo, are still counting.
       */
      readonly photoRejection?: keyof typeof needsCopy.photoRejected | undefined
    }
  | { readonly kind: 'conflict'; readonly itemId: string }
  | { readonly kind: 'undone'; readonly itemId: string }

/** Something that happened to the board as a whole rather than to one item. */
type BoardWideOutcome =
  | { readonly kind: 'too-late' }
  | { readonly kind: 'error'; readonly reason: keyof typeof needsCopy.errors }

export type BoardOutcome = ItemOutcome | BoardWideOutcome

function itemOutcome(
  outcome: BoardOutcome | undefined,
  itemId: string,
): ItemOutcome | undefined {
  if (outcome === undefined) return undefined
  if (outcome.kind === 'too-late' || outcome.kind === 'error') return undefined

  return outcome.itemId === itemId ? outcome : undefined
}

export interface NeedsBoardProps {
  readonly slug: string
  readonly items: readonly BoardItem[]
  readonly outcome?: BoardOutcome | undefined
  /** True when this browser holds the undo capability for `outcome.itemId`. */
  readonly canUndo?: boolean | undefined
}

export function NeedsBoard({ slug, items, outcome, canUndo = false }: NeedsBoardProps) {
  return (
    <ul className="needs">
      {items.map((item) => (
        <li key={item.id} className="need">
          <NeedRow
            slug={slug}
            item={item}
            outcome={itemOutcome(outcome, item.id)}
            canUndo={canUndo}
          />
        </li>
      ))}
    </ul>
  )
}

function NeedRow({
  slug,
  item,
  outcome,
  canUndo,
}: {
  slug: string
  item: BoardItem
  outcome?: ItemOutcome | undefined
  canUndo: boolean
}) {
  const taken = item.remaining === 0

  return (
    <div data-item={item.id}>
      <p className="needLabel">{item.label}</p>
      {item.note === null ? null : <p className="needNote">{item.note}</p>}

      <p className="needStatus" data-numeric="">
        {taken
          ? needsCopy.allTaken
          : needsCopy.remaining(item.remaining, item.quantityRequired, item.unit)}
      </p>

      {outcome?.kind === 'claimed' ? (
        <div className="claimed" role="status">
          <p className="claimedTitle">{needsCopy.claimed(item.noun)}</p>
          <p className="claimedBody">{needsCopy.claimedBody}</p>

          {/* The photo did not attach, said now — while undoing and claiming
              again is still possible (UX-11). */}
          {outcome.photoRejection === undefined ? null : (
            <>
              <p className="claimedBody">
                {needsCopy.photoRejected[outcome.photoRejection]}
              </p>
              <p className="claimHelp">{needsCopy.photoRejectedNext}</p>
            </>
          )}

          {canUndo ? (
            <form
              method="post"
              action="/api/claim/undo"
              className="claimForm"
              // Seconds, not an absolute time: the countdown runs from when
              // the page rendered, so a clock skewed by a few minutes on a
              // borrowed phone does not eat somebody's undo.
              data-undo-seconds={String(outcome.secondsLeft)}
            >
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="item" value={item.id} />
              <button type="submit" className="buttonQuiet" data-undo-button="">
                {needsCopy.undoWindow(outcome.secondsLeft)}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {outcome?.kind === 'conflict' ? (
        <div className="conflict" role="alert">
          <p className="claimedTitle">{needsCopy.conflictTitle(item.noun)}</p>
          <p className="claimedBody">{needsCopy.conflictBody}</p>
        </div>
      ) : null}

      {outcome?.kind === 'undone' ? (
        <div className="claimed" role="status">
          <p className="claimedTitle">{needsCopy.undoneTitle}</p>
          <p className="claimedBody">{needsCopy.undoneBody}</p>
        </div>
      ) : null}

      {taken || outcome?.kind === 'claimed' ? null : (
        <ClaimForm slug={slug} item={item} />
      )}
    </div>
  )
}

/**
 * The form itself. `method="post"` to a route handler, hidden fields for what
 * is being claimed — the shape Part C.5 specifies, and the shape that works
 * with no script at all.
 */
function ClaimForm({ slug, item }: { slug: string; item: BoardItem }) {
  const quantityId = `quantity-${item.id}`

  return (
    <form
      method="post"
      action="/api/claim"
      className="claimForm"
      // multipart because of the photograph (M4-02b). The form still works with
      // JavaScript off — the encoding changes what the browser sends, not who
      // sends it.
      encType="multipart/form-data"
      data-claim-form=""
      data-return={`/e/${slug}`}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="item" value={item.id} />

      {item.allowsPartialClaim ? (
        <div className="claimQuantity">
          <label className="claimLabel" htmlFor={quantityId}>
            {needsCopy.quantityLabel}
          </label>
          <input
            className="claimInput"
            id={quantityId}
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            max={item.remaining}
            defaultValue={1}
            data-numeric=""
          />
          <p className="claimHelp">{needsCopy.quantityHelp(item.remaining, item.unit)}</p>
        </div>
      ) : (
        <input type="hidden" name="quantity" value={String(item.quantityRequired)} />
      )}

      <label className="claimLabel" htmlFor={`name-${item.id}`}>
        {needsCopy.nameLabel}
      </label>
      <input
        className="claimInput"
        id={`name-${item.id}`}
        name="name"
        type="text"
        autoComplete="name"
        aria-describedby={`name-help-${item.id}`}
        required
      />
      <p className="claimHelp" id={`name-help-${item.id}`}>
        {needsCopy.nameHelp}
      </p>

      {/*
        What she wants said, and a photograph (M4-02b). Asked here because here
        is the only place she is: an in-kind row is not created until the
        organiser confirms delivery, days later, so there is no later moment at
        which the person with something to say is on the page.

        Neither is `required`. Somebody bringing chairs who writes nothing has
        still brought the chairs.
      */}
      <label className="claimLabel" htmlFor={`message-${item.id}`}>
        {needsCopy.messageLabel}
      </label>
      <textarea
        className="claimInput"
        id={`message-${item.id}`}
        name="message"
        rows={2}
        maxLength={500}
        aria-describedby={`message-help-${item.id}`}
      />
      <p className="claimHelp" id={`message-help-${item.id}`}>
        {needsCopy.messageHelp}
      </p>

      <label className="claimLabel" htmlFor={`photo-${item.id}`}>
        {needsCopy.photoLabel}
      </label>
      <input
        className="claimInput"
        id={`photo-${item.id}`}
        name="photo"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-describedby={`photo-help-${item.id}`}
      />
      <p className="claimHelp" id={`photo-help-${item.id}`}>
        {needsCopy.photoHelp}
      </p>

      <button type="submit" className="buttonPrimary" data-claim-button="">
        {item.allowsPartialClaim
          ? needsCopy.claimPart(item.noun)
          : needsCopy.claim(item.noun)}
      </button>
    </form>
  )
}

/**
 * "Is something missing?" — the contributor's half of suggestions (UX-19).
 *
 * `suggestItem` was built in M2-04 with no screen; M3-08 built the
 * organiser's answer and the group it feeds could still never populate,
 * because nothing let a contributor ask. One form, same posture as claiming:
 * `method="post"` to a route handler, works with no script, and the privacy
 * fact — only the family sees it, nothing is on the list until they agree —
 * is said before the name is asked.
 */
export function SuggestForm({
  slug,
  suggested,
}: {
  slug: string
  suggested?: 'done' | 'empty' | undefined
}) {
  const copy = needsCopy.suggest

  return (
    <div className="need">
      <p className="needLabel">{copy.heading}</p>
      <p className="claimHelp">{copy.intro}</p>

      {suggested === 'done' ? (
        <div className="claimed" role="status">
          <p className="claimedTitle">{copy.doneTitle}</p>
          <p className="claimedBody">{copy.doneBody}</p>
        </div>
      ) : (
        <>
          {suggested === 'empty' ? (
            <div className="conflict" role="alert">
              <p className="claimedBody">{copy.errors.empty}</p>
            </div>
          ) : null}

          <form method="post" action="/api/suggest" className="claimForm">
            <input type="hidden" name="slug" value={slug} />

            <label className="claimLabel" htmlFor="suggest-label">
              {copy.labelLabel}
            </label>
            <input
              className="claimInput"
              id="suggest-label"
              name="label"
              type="text"
              placeholder={copy.labelPlaceholder}
              required
            />

            <label className="claimLabel" htmlFor="suggest-name">
              {copy.nameLabel}
            </label>
            <input
              className="claimInput"
              id="suggest-name"
              name="name"
              type="text"
              autoComplete="name"
              aria-describedby="suggest-name-help"
              required
            />
            <p className="claimHelp" id="suggest-name-help">
              {copy.nameHelp}
            </p>

            <button type="submit" className="buttonQuiet">
              {copy.submit}
            </button>
          </form>
        </>
      )}
    </div>
  )
}

/** Shown above the board when something went wrong that is not about one item. */
export function BoardNotice({ outcome }: { outcome: BoardOutcome | undefined }) {
  if (outcome === undefined) return null

  if (outcome.kind === 'too-late') {
    return (
      <div className="conflict" role="alert">
        <p className="claimedTitle">{needsCopy.tooLateTitle}</p>
        <p className="claimedBody">{needsCopy.tooLateBody}</p>
      </div>
    )
  }

  if (outcome.kind === 'error') {
    return (
      <div className="conflict" role="alert">
        <p className="claimedBody">{needsCopy.errors[outcome.reason]}</p>
      </div>
    )
  }

  return null
}
