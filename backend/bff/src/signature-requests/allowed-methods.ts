import type { SignatureMethod } from '@prisma/client';

/**
 * Métodos que reescriben el PDF con pdf-lib para estamparlo (ver
 * `signing/autograph.adapter.ts` y `signing/pdf-stamp.service.ts`). Una vez que
 * el PDF presentado lleva una firma PAdES, reescribirlo la invalidaría
 * (`VISUAL_STAMP_AFTER_SIGNATURE_UNSUPPORTED`). DIGITAL no cuenta: tras la
 * primera firma PAdES firma de forma incremental y omite la apariencia.
 * BIOMETRICA/ACCEPT/PASSKEY no tocan el PDF.
 */
export const VISUAL_STAMP_METHODS: readonly SignatureMethod[] = ['AUTOGRAFA'];

export const VISUAL_AFTER_DIGITAL_ORDER = 'VISUAL_AFTER_DIGITAL_ORDER';

interface RequestLike {
  methods: SignatureMethod[];
  signers: { status: string; usedMethod?: SignatureMethod | null }[];
}

/**
 * ¿El PDF presentado ya lleva firma PAdES? Se deriva de los Signers ya
 * FIRMADO con `usedMethod = DIGITAL` (única fuente de firmas PAdES) para no
 * cargar el PDF desde storage en cada consulta.
 */
export function requestHasPadesSignature(request: Pick<RequestLike, 'signers'>): boolean {
  return request.signers.some((s) => s.status === 'FIRMADO' && s.usedMethod === 'DIGITAL');
}

/** Métodos que el siguiente firmante puede usar HOY sobre el estado actual del PDF. */
export function allowedMethodsForRequest(request: RequestLike): SignatureMethod[] {
  if (!requestHasPadesSignature(request)) return [...request.methods];
  return request.methods.filter((m) => !VISUAL_STAMP_METHODS.includes(m));
}

/**
 * Advertencia al crear: en orden SECUENCIAL, si se autoriza DIGITAL y algún
 * método visual, los firmantes posteriores a una firma DIGITAL ya no podrán
 * usar los visuales.
 */
export function creationWarnings(order: string, methods: SignatureMethod[]): string[] {
  const hasVisual = methods.some((m) => VISUAL_STAMP_METHODS.includes(m));
  return order === 'SECUENCIAL' && hasVisual && methods.includes('DIGITAL')
    ? [VISUAL_AFTER_DIGITAL_ORDER]
    : [];
}
