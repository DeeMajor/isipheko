import { generateCode } from '@/domain/reference'

/**
 * A reference code for a fixture event.
 *
 * `events.ref_prefix` and `ref_code` are NOT NULL — an event without a code
 * cannot show a contributor how to verify it — so every fixture needs one. The
 * real generator is used rather than a counter so fixtures exercise the same
 * alphabet the product does.
 */
export function uniqueRefCode(): string {
  return generateCode()
}
