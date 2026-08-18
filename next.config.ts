import type { NextConfig } from 'next'

// Importing the env module here — not just in instrumentation.ts — means a bad
// environment fails the *build*, not only the boot. A deploy that would have
// started with a missing variable never produces an artefact.
//
// Relative path, not '@/lib/env': next.config.ts is loaded before the tsconfig
// path aliases are in play.
import './src/lib/env'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The public event page has a hard 150KB budget (CLAUDE.md rule 9). The
  // CI gate that enforces it is M1-08; this is only the honest starting point.
  poweredByHeader: false,

  // The OG card is drawn by Satori, which reads `.woff` and not the `.woff2`
  // the page ships — so two font binaries live in src/assets/ and are read from
  // disk at request time. Standalone output traces imports, not `readFile`
  // paths, so they are named here. Without this the card renders as boxes in a
  // container that passed every test on a machine where src/ happened to exist.
  outputFileTracingIncludes: {
    '/e/[slug]/og/[file]': ['./src/assets/fonts/**'],
  },

  // `next dev` otherwise appends an agent-rules block to CLAUDE.md on every run.
  // CLAUDE.md is the behavioural contract for this project and its diffs have to
  // mean something; a framework editing it as a side effect of starting the dev
  // server takes that away. The one useful thing that block said — read
  // node_modules/next/dist/docs/ — is now a line we chose to write.
  agentRules: false,
}

export default nextConfig
