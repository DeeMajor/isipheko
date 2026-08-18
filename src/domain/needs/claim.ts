/**
 * The rules of the needs board.
 *
 * Pure. Quantities and timestamps come in as arguments, and the repository does
 * the reserving — but what may be claimed, by how much, and for how long is
 * decided here, once, where it can be read.
 *
 * **Claiming is never optimistic** (CLAUDE.md rule 5). Nothing in this file
 * predicts an outcome: `checkClaim` says whether a claim is *shaped* correctly
 * against quantities somebody has already read, and the reservation itself is a
 * conditional UPDATE with a database CHECK behind it. Two people tapping "I'll
 * bring the tent" at the same moment must not both see success, and the only
 * thing that can promise that is Postgres.
 */

/**
 * Seven days.
 *
 * Long enough that "I'll bring the tent" is a real commitment somebody plans
 * around, short enough that a claim made and forgotten does not hold a chair
 * until the morning of the funeral. A named constant because real organisers
 * will eventually tell us it is wrong, and that should be one edit.
 */
export const CLAIM_HOLD_MS = 7 * 24 * 60 * 60 * 1000

/** The notification matrix (§8.2) sends "your claim expires soon" at this point. */
export const CLAIM_WARNING_MS = 48 * 60 * 60 * 1000

export type NeedItemStatus = 'active' | 'suggested' | 'declined'
export type NeedClaimStatus = 'claimed' | 'delivered' | 'expired' | 'withdrawn'

/** Only what the rules need — not the Prisma row (CLAUDE.md rule 6). */
export interface NeedItemState {
  readonly status: NeedItemStatus
  readonly quantityRequired: number
  readonly quantityClaimed: number
}

export function remainingQuantity(item: NeedItemState): number {
  return Math.max(0, item.quantityRequired - item.quantityClaimed)
}

export function isFullyClaimed(item: NeedItemState): boolean {
  return remainingQuantity(item) === 0
}

/**
 * Whether part of this item can be taken.
 *
 * Derived from the quantity rather than stored as a flag. The designs carry a
 * `splittable` boolean, but it would always have to agree with
 * `quantity_required > 1` — and two fields that must agree eventually will not,
 * with the derived one being the one nobody remembers to update. A tent is one
 * tent; 20kg of meat is twenty.
 */
export function allowsPartialClaim(item: NeedItemState): boolean {
  return item.quantityRequired > 1
}

export type ClaimRejection =
  | 'not-open'
  | 'already-taken'
  | 'not-a-whole-number'
  | 'at-least-one'
  | 'more-than-remains'
  | 'all-or-nothing'

export type ClaimCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: ClaimRejection }

/**
 * Whether a claim is shaped correctly. **Not whether it will succeed** — by the
 * time this returns, somebody else may have taken the last chair. That race is
 * settled by the conditional update, not here.
 */
export function checkClaim(item: NeedItemState, quantity: number): ClaimCheck {
  if (item.status !== 'active') return { ok: false, reason: 'not-open' }
  if (!Number.isInteger(quantity)) return { ok: false, reason: 'not-a-whole-number' }
  if (quantity < 1) return { ok: false, reason: 'at-least-one' }
  if (isFullyClaimed(item)) return { ok: false, reason: 'already-taken' }

  // A tent taken half-way is not half a tent.
  if (!allowsPartialClaim(item) && quantity !== item.quantityRequired) {
    return { ok: false, reason: 'all-or-nothing' }
  }

  if (quantity > remainingQuantity(item)) {
    return { ok: false, reason: 'more-than-remains' }
  }

  return { ok: true }
}

export interface ClaimState {
  readonly status: NeedClaimStatus
  readonly expiresAt: Date | null
}

export function claimExpiresAt(now: Date): Date {
  return new Date(now.getTime() + CLAIM_HOLD_MS)
}

/**
 * A claim that has lapsed, whether or not the sweep has noticed.
 *
 * The claim path checks this before reserving, so a claim that expired an hour
 * ago never blocks somebody now. Waiting for a scheduled job would look like a
 * bug in the board rather than a bug in the sweep.
 */
export function hasLapsed(claim: ClaimState, now: Date): boolean {
  return (
    claim.status === 'claimed' &&
    claim.expiresAt !== null &&
    claim.expiresAt.getTime() <= now.getTime()
  )
}

export function isExpiringSoon(claim: ClaimState, now: Date): boolean {
  if (claim.status !== 'claimed' || claim.expiresAt === null) return false

  const remaining = claim.expiresAt.getTime() - now.getTime()
  return remaining > 0 && remaining <= CLAIM_WARNING_MS
}

/**
 * Whether a claim still holds its quantity.
 *
 * `delivered` does: the thing arrived, and the item is no less taken for it.
 * `expired` and `withdrawn` do not, and their quantity goes back to the board.
 */
export function holdsQuantity(status: NeedClaimStatus): boolean {
  return status === 'claimed' || status === 'delivered'
}

export function canWithdraw(status: NeedClaimStatus): boolean {
  return status === 'claimed'
}

/**
 * Only a live claim can be confirmed as delivered. Confirming an expired one
 * would silently re-reserve the quantity somebody else may already have taken.
 */
export function canConfirmDelivery(status: NeedClaimStatus): boolean {
  return status === 'claimed'
}
