import { describe, expect, it } from 'vitest'

import { checkCopy } from '@/copy/check'
import { collectionCopy } from '@/copy/collection'
import { eventCopy } from '@/copy/event'
import { notificationCopy } from '@/copy/notifications'
import { reportCopy } from '@/copy/report'
import { TEMPLATES } from '@/domain/messaging'
import {
  MAX_REPORTS_PER_ADDRESS_PER_HOUR,
  REPORT_REASONS,
  RESPONSE_WORKING_DAYS,
  checkReport,
  isOverdue,
  isReportReason,
  respondBy,
} from '@/domain/report'

/**
 * The report channel (M3-06).
 *
 * **57% of South Africans who report a scam hear nothing back.** Most of what
 * follows is about what the words promise, because the failure this task exists
 * against is not a bug — it is a form that takes a report and goes quiet, which
 * passes every functional test there is.
 */

const FRIDAY = new Date('2026-08-14T16:00:00.000Z')
const TUESDAY = new Date('2026-08-18T09:00:00.000Z')

describe('what counts as a report', () => {
  const draft = { reason: 'never-happened', detail: '', about: '', phone: '' }

  it('needs a reason, which is one tap', () => {
    expect(
      checkReport({ ...draft, reason: '' }, { identified: true, withinLimit: true }),
    ).toEqual({ ok: false, reason: 'no-reason' })
    expect(
      checkReport(
        { ...draft, reason: 'nonsense' },
        { identified: true, withinLimit: true },
      ),
    ).toEqual({ ok: false, reason: 'no-reason' })
  })

  it('takes a report about a page we hold with nothing else said', () => {
    // The bar is deliberately low. Somebody who has just been shown a fake page
    // should not have to write an essay.
    expect(checkReport(draft, { identified: true, withinLimit: true })).toEqual({
      ok: true,
    })
  })

  it('takes a report about nothing we hold, which is the most valuable kind', () => {
    // A link that resolves to nothing is the scam case.
    expect(
      checkReport(
        { ...draft, about: 'isipheko-funerals.co.za/e/whatever' },
        { identified: false, withinLimit: true },
      ),
    ).toEqual({ ok: true })

    expect(
      checkReport(
        { ...draft, detail: 'a man phoned me about a funeral I never heard of' },
        { identified: false, withinLimit: true },
      ),
    ).toEqual({ ok: true })
  })

  it('refuses an empty form, and nothing else', () => {
    expect(checkReport(draft, { identified: false, withinLimit: true })).toEqual({
      ok: false,
      reason: 'nothing-said',
    })
  })

  it('stops a script burying the queue somebody else is waiting in', () => {
    expect(MAX_REPORTS_PER_ADDRESS_PER_HOUR).toBe(5)
    expect(checkReport(draft, { identified: true, withinLimit: false })).toEqual({
      ok: false,
      reason: 'rate-limited',
    })
  })

  it('names every reason it will accept', () => {
    expect(REPORT_REASONS).toHaveLength(5)
    for (const reason of REPORT_REASONS) {
      expect(isReportReason(reason)).toBe(true)
      expect(reportCopy.reasons[reason].length).toBeGreaterThan(10)
    }
  })
})

describe('the window', () => {
  it('is one working day, in the record and on the page', () => {
    expect(RESPONSE_WORKING_DAYS).toBe(1)
    expect(eventCopy.trust.wrongBody).toContain('within one working day')
    expect(reportCopy.filed.when('18 August')).toContain('18 August')
  })

  it('skips the weekend rather than quietly missing it', () => {
    // A report filed on Friday evening is answered on Monday. Saying so beats a
    // deadline that was never going to be met and then was not.
    expect(respondBy(FRIDAY).getUTCDay()).toBe(1)
    expect(respondBy(TUESDAY).getUTCDay()).toBe(3)
  })

  it('is only overdue while nobody has looked', () => {
    const deadline = respondBy(TUESDAY)
    const later = new Date(deadline.getTime() + 1)

    expect(isOverdue(deadline, 'received', later)).toBe(true)
    expect(isOverdue(deadline, 'received', TUESDAY)).toBe(false)
    // Somebody has picked it up: the window did its job.
    expect(isOverdue(deadline, 'reviewing', later)).toBe(false)
    expect(isOverdue(deadline, 'closed', later)).toBe(false)
  })
})

describe('what the words promise', () => {
  it('does not say anything happens to the page', () => {
    // The standing rule: a report does nothing by itself, and copy claiming
    // otherwise would be untrue *and* would make the form a weapon.
    const strings = JSON.stringify(reportCopy).toLowerCase()

    expect(strings).not.toContain('we will take it down')
    expect(strings).not.toContain('suspend')
    expect(strings).not.toContain('we will hold')
    expect(strings).not.toContain('frozen')
    expect(reportCopy.filed.whatHappens).toContain('Nothing changes on the page')
  })

  it('tells somebody with no number that the screen is all they get', () => {
    // The alternative is a person waiting for a message that was never coming,
    // which is the 57% finding reproduced by our own hand.
    expect(reportCopy.filed.unreachable).toContain('this screen is the whole of what')
    expect(reportCopy.phoneNone).toContain('you just will not hear the outcome')
  })

  it('makes the reference the acknowledgement, and tells them to keep it', () => {
    expect(reportCopy.filed.reference('REP-4K7B2X')).toContain('REP-4K7B2X')
    expect(reportCopy.filed.keep.toLowerCase()).toContain('write it down')
  })

  it('never asks for an email, and never for an account', () => {
    const strings = JSON.stringify(reportCopy).toLowerCase()

    for (const word of ['email', 'sign up', 'signup', 'register', 'password', 'log in']) {
      expect(strings, word).not.toContain(word)
    }
    expect(reportCopy.lead).toContain('you do not need an account')
  })

  it('thanks somebody for a minute nobody owed anybody', () => {
    expect(reportCopy.filed.thanks).toContain('nobody owes anybody')
  })
})

describe('the restored half of the trust panel', () => {
  it('offers the report channel now that there is one', () => {
    // M3-04 removed both halves of the prototype's sentence because neither was
    // true. This is the half M3-06 made true.
    expect(eventCopy.trust.wrongBody).toContain('isipheko.co.za/report')
    expect(eventCopy.trust.wrongBody).not.toContain('no way to report a page to us yet')
  })

  it('still promises no payment hold, because no payment passes through us', () => {
    // Mode A: the organiser is paid directly. Mode B is gated on the legal
    // opinion (§15 item 1). There is nothing to hold.
    for (const line of [eventCopy.trust.wrongBody, collectionCopy.page.wrongBody]) {
      expect(line).not.toContain('hold every payment')
      expect(line.toLowerCase()).not.toContain('until a person has looked')
    }
  })

  it('keeps the typed instruction primary, like /check', () => {
    for (const line of [eventCopy.trust.wrongBody, collectionCopy.page.wrongBody]) {
      expect(line).toContain('type isipheko.co.za/report into your browser yourself')
    }
    expect(reportCopy.linkLabel).toBe('isipheko.co.za/report')
  })

  it('offers the report path from /check, where a dead link is found', () => {
    expect(checkCopy.notFound.tellUs).toContain('one working day')
  })
})

describe('the acknowledgement message', () => {
  it('is a utility template, like every other one', () => {
    expect(TEMPLATES.reporter_report_received.category).toBe('utility')
    expect(TEMPLATES.reporter_report_received.metaName).toBe('report_received_v1')
  })

  it('carries the reference and the window, and nothing about the page', () => {
    // Somebody may be reporting their own family, and this message can be read
    // over a shoulder.
    const body = notificationCopy.reporter_report_received({
      reference: 'REP-4K7B2X',
      respondBy: '18 August',
    })

    expect(body).toContain('REP-4K7B2X')
    expect(body).toContain('18 August')
    expect(body).not.toContain('http')
    expect(body.toLowerCase()).not.toContain('umcimbi')
    // §10: every outbound message says we never ask for a code.
    expect(body).toContain('never ask you for a code')
  })

  it('fills its parameters in the order the wire expects', () => {
    expect(TEMPLATES.reporter_report_received.params).toEqual(['reference', 'respondBy'])
  })
})
