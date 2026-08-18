import type { PrismaClient } from '../generated/client.ts'
import type {
  AuditAction,
  AuditActorType,
  AuditMetadata,
  AuditTargetType,
} from '../../domain/audit/index.ts'

/**
 * The audit log — the one write, and the reads the review screen makes.
 *
 * **Append-only, and not by convention.** The application role holds INSERT and
 * SELECT on `audit_log` and neither UPDATE nor DELETE
 * (`20260807235900_constraints_and_grants`), so a row written here cannot later
 * be tidied away by the code that wrote it, by an ORM call, or by raw SQL. That
 * is the same mechanism the ledger uses and for the same reason: an audit trail
 * the application can edit is not an audit trail. There is deliberately no
 * `updateAudit` and no `deleteAudit` in this file — they would not compile
 * against the schema, and their absence is the documentation.
 *
 * **Nothing identifying is written in the clear.** Hashing happens in
 * `src/lib/audit.ts`, which is where the request and the pepper are; this file
 * takes what it is given and inserts it. See rule 8 and the taxonomy in
 * `src/domain/audit/actions.ts` for what may appear in `metadata`.
 *
 * Relative imports with extensions, like the other repositories (M2-01 §8).
 */

export interface AuditEntry {
  readonly actorType: AuditActorType
  readonly actorId: string | null
  readonly action: AuditAction
  readonly targetType: AuditTargetType | null
  readonly targetId: string | null
  readonly ipHash: string | null
  readonly userAgentHash: string | null
  readonly metadata: AuditMetadata
  /**
   * Supplied by the caller, never defaulted by the column — CLAUDE.md's rule
   * about timestamps a rule is computed against (M2-08b §6). Retention reads
   * this, and so does every "what happened in the hour before" question the log
   * exists to answer.
   */
  readonly now?: Date
}

export async function recordAudit(db: PrismaClient, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      ipHash: entry.ipHash,
      userAgentHash: entry.userAgentHash,
      metadata: entry.metadata,
      createdAt: entry.now ?? new Date(),
    },
  })
}

export interface AuditRow {
  readonly id: string
  readonly action: string
  readonly actorType: string
  readonly actorId: string | null
  readonly createdAt: Date
  readonly metadata: AuditMetadata
}

const TRAIL_LIMIT = 50

/**
 * What has happened to one thing, most recent first.
 *
 * This is why the audit log and the review screen shipped together
 * (docs/decisions.md M3-06 §9). Somebody deciding what to do about a reported
 * event needs to know when it was published, whether the organiser is verified,
 * how many contributions were confirmed and when — and every one of those is a
 * row here rather than a field anywhere else.
 *
 * Capped, because an event that has run for a season has more rows than a
 * person reads and this renders on a page.
 */
export async function auditForTarget(
  db: PrismaClient,
  {
    targetType,
    targetId,
    limit = TRAIL_LIMIT,
  }: { targetType: AuditTargetType; targetId: string; limit?: number },
): Promise<readonly AuditRow[]> {
  const rows = await db.auditLog.findMany({
    where: { targetType, targetId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      action: true,
      actorType: true,
      actorId: true,
      createdAt: true,
      metadata: true,
    },
  })

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorType: row.actorType,
    actorId: row.actorId,
    createdAt: row.createdAt,
    metadata: (row.metadata ?? {}) as AuditMetadata,
  }))
}

/**
 * The same trail for an actor rather than a target.
 *
 * Its first caller is the review screen's own accountability: an admin can see
 * what another admin has read and decided, which is the point of logging
 * reading at all.
 */
export async function auditForActor(
  db: PrismaClient,
  {
    actorType,
    actorId,
    limit = TRAIL_LIMIT,
  }: { actorType: AuditActorType; actorId: string; limit?: number },
): Promise<readonly AuditRow[]> {
  const rows = await db.auditLog.findMany({
    where: { actorType, actorId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      action: true,
      actorType: true,
      actorId: true,
      createdAt: true,
      metadata: true,
    },
  })

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorType: row.actorType,
    actorId: row.actorId,
    createdAt: row.createdAt,
    metadata: (row.metadata ?? {}) as AuditMetadata,
  }))
}
