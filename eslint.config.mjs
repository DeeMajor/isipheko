import next from 'eslint-config-next/core-web-vitals'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

/**
 * The layers `src/domain/` may not reach into. CLAUDE.md rule 6.
 *
 * Patterns are gitignore-style, matched against the import source string. Each
 * layer gets both the aliased form (`@/db/client`) and the bare form, which is
 * what catches a relative escape (`../db/client`, `../../../db/client`) at any
 * depth. The relative form is the one that gets used by accident — an editor
 * auto-import will happily write `../../adapters/payments` and it reads as
 * innocuous in review.
 */
const FORBIDDEN_LAYERS = ['app', 'adapters', 'db']

const layerPatterns = FORBIDDEN_LAYERS.flatMap((layer) => [
  `@/${layer}`,
  `@/${layer}/**`,
  `**/${layer}`,
  `**/${layer}/**`,
])

const BOUNDARY_MESSAGE =
  'src/domain/ is pure — it may not import from app/, adapters/ or db/, by alias or by ' +
  'relative path. This boundary is what makes the payment provider swappable, which ' +
  'matters while the Mode B regulatory position is unresolved. Invert the dependency: ' +
  'define the interface in domain/ and implement it in the outer layer. See CLAUDE.md ' +
  'rule 6 and docs/architecture.md §5.1.'

const FRAMEWORK_MESSAGE =
  'src/domain/ is pure — no framework, no ORM, no I/O. Type-only imports count: a ' +
  'Prisma type in domain/ couples the business rules to the schema. Define the shape ' +
  'in domain/ and map to it at the db/ boundary. See CLAUDE.md rule 6.'

const IO_MESSAGE =
  'src/domain/ performs no I/O. Take the data as an argument and let the caller in ' +
  'adapters/ or db/ do the reading. (node:crypto is allowed — the ledger hash chain ' +
  'in docs/architecture.md §4.3 is domain logic.)'

const forbiddenIoModules = [
  'fs',
  'fs/promises',
  'http',
  'https',
  'net',
  'dns',
  'child_process',
  'dgram',
  'worker_threads',
]

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
      // Exported reference screens, not source.
      'design/**',
    ],
  },

  ...next,

  // Type-aware linting. This is why typescript-eslint is a dependency: the
  // ledger append, the claim round-trip and the payment adapter are all async
  // paths where a dropped `await` corrupts a record silently instead of
  // throwing. no-floating-promises catches that class at lint time.
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    name: 'isipheko/domain-boundary',
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'next', message: FRAMEWORK_MESSAGE },
            { name: 'react', message: FRAMEWORK_MESSAGE },
            { name: 'react-dom', message: FRAMEWORK_MESSAGE },
            { name: '@prisma/client', message: FRAMEWORK_MESSAGE },
            { name: 'prisma', message: FRAMEWORK_MESSAGE },
            { name: 'server-only', message: FRAMEWORK_MESSAGE },
            { name: 'client-only', message: FRAMEWORK_MESSAGE },
            ...forbiddenIoModules.flatMap((name) => [
              { name, message: IO_MESSAGE },
              { name: `node:${name}`, message: IO_MESSAGE },
            ]),
          ],
          patterns: [
            { group: layerPatterns, message: BOUNDARY_MESSAGE },
            {
              group: ['next/**', 'react/**', 'react-dom/**'],
              message: FRAMEWORK_MESSAGE,
            },
          ],
        },
      ],
    },
  },

  {
    name: 'isipheko/config-files',
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Last: turns off every rule Prettier already decides.
  prettier,
)
