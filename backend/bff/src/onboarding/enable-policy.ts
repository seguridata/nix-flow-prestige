import { ConflictException } from '@nestjs/common';

export type EnableReviewMode = 'engine' | 'manual' | 'manual-override';

interface EnableCase {
  livenessOk: boolean;
  faceMatchOk: boolean;
  biometricEngine: string | null;
}

/**
 * Cómo se habilita una identidad para firmar. Nunca se marca `livenessOk` por decreto:
 * el modo de revisión queda explícito (y se audita), no disfrazado de resultado de motor.
 *
 * - `engine`: el motor biométrico corrió y pasó liveness + face match.
 * - `manual`: no hay motor (noop / face-api sin modelos): decide RH, como documenta el alta.
 * - `manual-override`: el motor corrió y NO pasó; solo con anulación explícita y motivo.
 */
export function decideEnableMode(
  current: EnableCase,
  override: { override?: boolean; notes?: string },
): EnableReviewMode {
  if (current.livenessOk && current.faceMatchOk) return 'engine';
  const engine = current.biometricEngine ?? 'noop';
  if (engine === 'noop') return 'manual';
  const notes = (override.notes ?? '').trim();
  if (override.override === true && notes.length >= 10) return 'manual-override';
  throw new ConflictException({
    error: 'BIOMETRIC_NOT_PASSED',
    message:
      'La prueba biométrica no pasó (liveness o coincidencia facial). ' +
      'Para habilitar de todos modos, RH debe anular con override=true y un motivo de al menos 10 caracteres.',
  });
}

/** `signerId` base a partir del correo; el resto del correo se descarta (colisiona entre dominios). */
export function baseSignerId(email: string, caseId: string): string {
  return email.split('@')[0].replace(/[^a-z0-9._-]/gi, '') || caseId.slice(0, 8);
}

/**
 * Devuelve un `signerId` libre en el tenant. Si el base ya lo usa OTRO correo habilitado,
 * se le agrega un sufijo estable derivado del id del alta (no del azar, para ser idempotente).
 */
export async function uniqueSignerId(
  base: string,
  email: string,
  caseId: string,
  isTakenByOther: (candidate: string, email: string) => Promise<boolean>,
): Promise<string> {
  if (!(await isTakenByOther(base, email))) return base;
  const suffixed = `${base}-${caseId.replace(/[^a-z0-9]/gi, '').slice(0, 6)}`;
  if (!(await isTakenByOther(suffixed, email))) return suffixed;
  throw new ConflictException({
    error: 'SIGNER_ID_COLLISION',
    message: 'No se pudo asignar un identificador de firmante único para este correo',
  });
}
