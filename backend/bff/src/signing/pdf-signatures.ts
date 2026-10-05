import { ConflictException } from '@nestjs/common';

/** Firmas ya incrustadas: ByteRange con enteros (el placeholder lleva asteriscos). */
export function countSignatures(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/ByteRange\s*\[\s*\d+\s+\d+\s+\d+\s+\d+\s*\]/g) ?? []).length;
}

export function hasPadesSignature(pdf: Buffer): boolean {
  return countSignatures(pdf) > 0;
}

/**
 * Regla de orden: pdf-lib reescribe el archivo completo al guardar, lo que
 * invalida cualquier firma PAdES previa. Por eso las firmas visibles
 * (AUTOGRAFA / apariencia) deben ir ANTES que las DIGITAL.
 */
export function assertNoPriorSignatureForVisualStamp(pdf: Buffer): void {
  if (hasPadesSignature(pdf)) {
    throw new ConflictException({
      error: 'VISUAL_STAMP_AFTER_SIGNATURE_UNSUPPORTED',
      message:
        'El documento ya contiene una firma digital (PAdES); estampar una firma visible/autógrafa ' +
        'lo reescribiría e invalidaría las firmas previas. Las firmas autógrafas deben ir antes que las digitales.',
    });
  }
}
