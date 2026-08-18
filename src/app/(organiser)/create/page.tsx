import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { archetypeSetupCopy, setupCopy } from '@/copy/setup'
import { ARCHETYPES, ARCHETYPE_KEYS, type ArchetypeKey } from '@/domain/archetype'
import { currentSession } from '@/lib/session'
import { Button } from '@/ui/primitives'

import { SetupShell } from './setup-shell'

import styles from './setup.module.css'

/**
 * Step one: what kind of umcimbi, and what that will mean.
 *
 * The consequence preview is the reason this step exists as its own screen.
 * Choosing "funeral" quietly turns off targets, amounts and motion, and an
 * organiser who discovers that on a published page has already sent the link.
 * The list comes from `ArchetypeConfig.consequences` (M1-04), so what is
 * promised here is the same object that decides what renders later.
 *
 * No row is written yet — `events.title` is NOT NULL and there is no title to
 * write. The chosen kind travels in the query string, which is an archetype
 * key and not personal data.
 */

export const metadata: Metadata = {
  title: 'Set up your umcimbi · Isipheko',
  robots: { index: false, follow: false },
}

export default async function ChooseKindPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>
}) {
  if ((await currentSession()) === null) redirect('/sign-in')

  const { kind } = await searchParams
  const chosen = ARCHETYPE_KEYS.includes(kind as ArchetypeKey)
    ? ARCHETYPES[kind as ArchetypeKey]
    : null

  return (
    <SetupShell
      step="kind"
      archetype={chosen ?? undefined}
      crumb={chosen === null ? 'Setting up' : archetypeSetupCopy[chosen.key].zulu}
    >
      <h1 className={styles.title}>{setupCopy.kind.title}</h1>
      <p className={styles.intro}>{setupCopy.kind.intro}</p>

      <div className={styles.kinds}>
        {ARCHETYPE_KEYS.map((key) => {
          const copy = archetypeSetupCopy[key]
          const active = chosen?.key === key

          return (
            <Link
              key={key}
              href={`/create?kind=${key}`}
              className={[styles.kind, active ? styles.kindActive : ''].join(' ')}
              aria-current={active ? 'true' : undefined}
            >
              <span
                className={[styles.bead, active ? styles.beadActive : ''].join(' ')}
                aria-hidden="true"
              />
              <span>
                <span className={styles.kindTitle}>{copy.title}</span>
                <span className={styles.kindZulu}>{copy.zulu}</span>
              </span>
            </Link>
          )
        })}
      </div>

      {chosen === null ? null : (
        <>
          <section className={styles.consequences} aria-labelledby="consequences-heading">
            <div className={styles.consequenceHead}>
              <h2 className={styles.consequenceTitle} id="consequences-heading">
                {archetypeSetupCopy[chosen.key].sampleTitle}
              </h2>
              <p className={styles.consequenceKicker}>
                {chosen.kicker} ·{' '}
                {chosen.amountsPublic ? 'amounts shown' : 'amounts hidden'}
              </p>
            </div>

            <ul className={styles.consequenceList}>
              {chosen.consequences.map((consequence) => (
                <li key={consequence.label} className={styles.consequence}>
                  <span className={styles.mark} aria-hidden="true" />
                  <span>
                    <p className={styles.consequenceLabel}>{consequence.label}</p>
                    <p className={styles.consequenceDetail}>{consequence.detail}</p>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <p className={styles.foot}>{setupCopy.kind.foot}</p>

          <form action={`/create/details`} className={styles.form}>
            <input type="hidden" name="kind" value={chosen.key} />
            <Button type="submit">
              {setupCopy.kind.submit(archetypeSetupCopy[chosen.key].title)}
            </Button>
          </form>
        </>
      )}
    </SetupShell>
  )
}
