import { createHash } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PdfStampService } from './pdf-stamp.service';
import { assertNoPriorSignatureForVisualStamp } from './pdf-signatures';
import type { SignCommand, SignResult, SignerAdapter } from './signer-adapter';

/**
 * AUTÓGRAFA — el trazo (PNG de signature_pad) se sella en el recuadro del PDF
 * con pdf-lib y se ata al hash del documento. Devuelve el PDF con la firma
 * incrustada (`signedPdf`).
 */
@Injectable()
export class AutographSignerAdapter implements SignerAdapter {
  readonly method = 'AUTOGRAFA' as const;

  constructor(private readonly stamp: PdfStampService) {}

  capabilities() {
    return { configured: true };
  }

  async sign(command: SignCommand): Promise<SignResult> {
    if (!command.signatureImage?.length) {
      throw new BadRequestException('La firma autógrafa requiere el trazo capturado (campo `file`)');
    }
    // Falla temprano (409) si el PDF ya trae firma PAdES: el estampado la invalidaría.
    assertNoPriorSignatureForVisualStamp(command.pdfBytes);
    const strokeHash = createHash('sha256').update(command.signatureImage).digest('hex');
    const signedPdf = await this.stamp.stampAutograph(
      command.pdfBytes,
      command.signatureImage,
      command.field,
    );
    const signatureHash = createHash('sha256')
      .update(`${command.documentHash}:${strokeHash}`)
      .digest('hex');
    return {
      algorithm: 'SHA-256 + trazo (pdf-lib)',
      signatureHash,
      provider: 'signature_pad',
      signedPdf,
    };
  }
}
