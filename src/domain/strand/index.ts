/**
 * `import { densityFor, bandFor } from '@/domain/strand'`.
 *
 * The strand's arithmetic only. What a bead *says* — the name, the words, the
 * item — is copy (rule 11) and lives in `src/copy/event.ts`; what it is drawn
 * from is the ledger, and that read lives in `src/db/repositories/strand.ts`.
 */

export {
  type BandInput,
  type BeadForm,
  type BeadPosition,
  type DensityBand,
  type SizeBand,
  BAND_DIAMETERS,
  BAND_THRESHOLDS_CENTS,
  CORD_PITCH,
  DENSITY,
  UNIFORM_BAND,
  bandFor,
  beadDiameter,
  daysBetween,
  densityFor,
  positionFor,
  rowsFor,
  strandHeight,
} from './strand.ts'
