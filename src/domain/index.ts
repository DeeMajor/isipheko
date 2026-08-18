/**
 * Pure business logic. No I/O, no framework, no Prisma types.
 *
 * Nothing here may import from `app/`, `adapters/` or `db/`, by alias or by
 * relative path. ESLint enforces it (see eslint.config.mjs) and
 * tests/unit/domain-boundary.test.ts proves the rule actually fires.
 *
 * This boundary is what makes the payment provider swappable, which matters
 * because the regulatory position on Mode B is unresolved — see
 * docs/architecture.md §0.2 and §15 item 1.
 *
 * Only types are re-exported here. The operations are deliberately not, because
 * `add` and `sum` mean nothing at this level and would collide with the next
 * module that needs those names — import them from the module that owns them:
 * `import { add, formatMoney } from '@/domain/money'`.
 */

export type { Money } from './money'
export type {
  AnimatedArchetype,
  ArchetypeConfig,
  ArchetypeGroup,
  ArchetypeKey,
  Consequence,
  NeedTemplateId,
  TargetedArchetype,
} from './archetype'

export type {
  OtpChallengeState,
  OtpChallengeStatus,
  OtpRequestCounts,
  PhoneParseResult,
  RateLimitDecision,
  SessionState,
  SessionStatus,
} from './auth'

export type { SmsMessage, SmsSender } from './messaging'

export type { DraftState, PublishDecision, SetupStep } from './event'

export type {
  ChainEntry,
  ChainProblem,
  ChainReport,
  LedgerDirection,
  LedgerEntryFields,
  LedgerEntryType,
} from './ledger'

export type { Reference } from './reference'

export type {
  ClaimCheck,
  ClaimRejection,
  ClaimState,
  NeedClaimStatus,
  NeedItemState,
  NeedItemStatus,
} from './needs'

export type { BandInput, BeadForm, BeadPosition, DensityBand, SizeBand } from './strand'
