import { describe, expect, it } from 'vitest'

import {
  canTriage,
  hoursWaiting,
  isReportStatus,
  nextTriageStatuses,
  type ReportStatus,
} from '@/domain/report'

/**
 * Triage — how far the reading of a report has got, and nothing more (M3-07).
 *
 * The rule under test is a shape rather than a calculation: **one direction,
 * and no reopening.** A reviewer who can walk a report backwards can also walk
 * it backwards to hide that they closed it, and the audit log is the record of
 * what was decided rather than the status column.
 */

const ALL: readonly ReportStatus[] = ['received', 'reviewing', 'closed']

describe('a report moves one way', () => {
  it('goes not-read → being-read → decided', () => {
    expect(canTriage('received', 'reviewing')).toBe(true)
    expect(canTriage('reviewing', 'closed')).toBe(true)
  })

  it('lets a reviewer close one they have not opened', () => {
    // Ordinary: a report about a page that plainly is not ours is read and
    // decided in one sitting. Forcing a two-step would make the extra step
    // meaningless rather than deliberate.
    expect(canTriage('received', 'closed')).toBe(true)
  })

  it('never goes back', () => {
    expect(canTriage('reviewing', 'received')).toBe(false)
    expect(canTriage('closed', 'reviewing')).toBe(false)
    expect(canTriage('closed', 'received')).toBe(false)
  })

  it('is not a transition to where it already is', () => {
    for (const status of ALL) {
      expect(canTriage(status, status), status).toBe(false)
    }
  })

  it('ends', () => {
    expect(nextTriageStatuses('closed')).toEqual([])
  })

  it('offers exactly the transitions it permits', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        expect(nextTriageStatuses(from).includes(to), `${from} → ${to}`).toBe(
          canTriage(from, to),
        )
      }
    }
  })
})

describe('a status arriving from a form', () => {
  it('recognises the three', () => {
    for (const status of ALL) expect(isReportStatus(status)).toBe(true)
  })

  it('rejects anything else', () => {
    // The `from` field is a hidden input, so it is whatever somebody posts.
    expect(isReportStatus('deleted')).toBe(false)
    expect(isReportStatus('RECEIVED')).toBe(false)
    expect(isReportStatus('')).toBe(false)
  })
})

describe('how long somebody has been waiting', () => {
  const filed = new Date('2026-08-18T09:00:00.000Z')

  it('counts whole hours', () => {
    expect(hoursWaiting(filed, new Date('2026-08-18T11:30:00.000Z'))).toBe(2)
  })

  it('is zero inside the first hour', () => {
    expect(hoursWaiting(filed, new Date('2026-08-18T09:59:00.000Z'))).toBe(0)
  })

  it('never goes negative on a clock that disagrees', () => {
    // A row created a moment ahead of the reader's clock should read as new,
    // not as "waiting -1 hours".
    expect(hoursWaiting(filed, new Date('2026-08-18T08:00:00.000Z'))).toBe(0)
  })
})
