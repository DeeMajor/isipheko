import type { Metadata } from 'next'

import { archetypeSetupCopy, setupCopy } from '@/copy/setup'
import { verifyView } from '@/lib/identity'
import { Button } from '@/ui/primitives'

import { withFormErrors } from '../../../verify/form-errors'
import { VerifyPanel } from '../../../verify/verify-panel'
import { SetupShell } from '../../setup-shell'
import { loadDraft } from '../draft'

import styles from '../../setup.module.css'

/**
 * Step five: the identity check.
 *
 * The panel is the one from `/verify`, rendered inside the setup shell rather
 * than reimplemented — one screen, one file, the same lesson `design/` learned
 * in M1-01 §12. Verification is a property of the person, so doing it here
 * verifies every event and every collection they run, not this draft.
 *
 * **This step no longer collects nothing.** M1-07 §5 rendered the words and
 * asked for nothing at all, because storing an ID number was impossible without
 * the hashing path this task builds and collecting one to discard it would have
 * been the worst of the three options available. That is now closed.
 *
 * The publish gate itself is M3-02: `canPublish` still carries no verification
 * clause, so an unverified draft can still be published today. This step sets
 * the status; the next task is what makes it required.
 */

export const metadata: Metadata = {
  title: 'One check · Isipheko',
  robots: { index: false, follow: false },
}

export default async function VerifyStep({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ id?: string; blocked?: string; name?: string }>
}) {
  const { id } = await params
  const { draft, archetype, organiserId } = await loadDraft(id)
  const { id: idError, blocked, name } = await searchParams

  const view = withFormErrors(await verifyView(organiserId), {
    id: idError,
    blocked,
    name,
  })

  return (
    <SetupShell
      step="verify"
      archetype={archetype}
      crumb={archetypeSetupCopy[archetype.key].zulu}
    >
      <VerifyPanel
        view={view}
        returnTo={`/create/${draft.id}/share`}
        on={`/create/${draft.id}/verify`}
        title={setupCopy.verify.title}
        lead={setupCopy.verify.lead}
        intro={setupCopy.verify.body}
      />

      <section className={styles.panel} aria-labelledby="why-heading">
        <h2 className={styles.panelTitle} id="why-heading">
          {setupCopy.verify.whyTitle}
        </h2>
        {setupCopy.verify.why.map((reason) => (
          <p key={reason.slice(0, 24)} className={styles.panelBody}>
            {reason}
          </p>
        ))}
        <p className={styles.panelBody}>{setupCopy.verify.whyClose}</p>
      </section>

      {/* The publish gate is M3-02, so the flow still continues from here
          whatever the check said. A GET form rather than a link wrapping a
          button: nested interactive content fails axe and is announced twice. */}
      {view.kind === 'verified' ? null : (
        <form action={`/create/${draft.id}/share`} className={styles.form}>
          <Button type="submit" variant="secondary">
            {setupCopy.verify.submit}
          </Button>
        </form>
      )}

      <p className={styles.foot}>{setupCopy.verify.idNote}</p>
    </SetupShell>
  )
}
