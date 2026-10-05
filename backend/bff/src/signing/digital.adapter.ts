import { createHash } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import { SUBFILTER_ETSI_CADES_DETACHED, extractSignature } from '@signpdf/utils';
import { KEY_CUSTODIAN, type KeyCustodian } from './pki/key-custodian';
import { PdfStampService } from './pdf-stamp.service';
import type { SignCommand, SignResult, SignerAdapter, VerifyResult } from './signer-adapter';

/** Firmas ya incrustadas: ByteRange con enteros (el placeholder lleva asteriscos). */
export function countSignatures(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/ByteRange\s*\[\s*\d+\s+\d+\s+\d+\s+\d+\s*\]/g) ?? []).length;
}

/**
 * DIGITAL — firma PAdES real (M09). Emite/usa un certificado X.509 del
 * `KeyCustodian` (software por defecto, HSM PKCS#11 conmutable por env) y
 * embebe un PKCS#7 CAdES-detached (`ETSI.CAdES.detached`) sobre el ByteRange
 * del PDF. Verificable en Adobe Acrobat. Reemplaza al HMAC de desarrollo.
 */
@Injectable()
export class DigitalSignerAdapter implements SignerAdapter {
  readonly method = 'DIGITAL' as const;
  private readonly log = new Logger(DigitalSignerAdapter.name);

  constructor(
    @Inject(KEY_CUSTODIAN) private readonly custodian: KeyCustodian,
    private readonly stamp: PdfStampService,
  ) {}

  capabilities() {
    return {
      configured: true,
      reason:
        this.custodian.kind === 'software'
          ? 'PAdES real con CA interna del proyecto (software). Conmutar a HSM con KEY_CUSTODIAN=pkcs11.'
          : 'PAdES real contra HSM PKCS#11.',
    };
  }

  async sign(command: SignCommand): Promise<SignResult> {
    const material = await this.custodian.getSigningMaterial(command.signerId, command.signerName);
    const at = new Date();

    // Multi-firma en serie: si el PDF ya trae una firma PAdES, CUALQUIER
    // reescritura con pdf-lib (`load().save()`) cambia bytes dentro del
    // ByteRange previo y la invalida. Se firma entonces sólo por ACTUALIZACIÓN
    // INCREMENTAL (el placeholder se anexa al final) y se omite la apariencia
    // visible — pdf-lib no sabe guardar de forma incremental.
    const priorSignatures = countSignatures(command.pdfBytes);
    if (priorSignatures > 0) return this.signIncremental(command, material, at);

    // 1. Apariencia visible (opcional). La firma criptográfica va aparte.
    const canvas = command.field
      ? await this.stamp.stampDigitalAppearance(
          command.pdfBytes,
          {
            name: command.signerName ?? command.signerId,
            subject: material.certificate.subject,
            serialNumber: material.certificate.serialNumber,
            at,
          },
          command.field,
        )
      : command.pdfBytes;

    // `@signpdf/placeholder-plain` necesita tabla xref clásica; pdf-lib genera
    // xref-streams por defecto. Normalizamos con `useObjectStreams: false`.
    const normalized = Buffer.from(
      await (await PDFDocument.load(canvas)).save({ useObjectStreams: false }),
    );

    // 2. Placeholder PAdES + 3. firma PKCS#7 con el P12 del custodio.
    const withPlaceholder = plainAddPlaceholder({
      pdfBuffer: normalized,
      reason: 'Firma electrónica — Prestige (SeguriData)',
      contactInfo: command.signerId,
      name: command.signerName ?? command.signerId,
      location: 'MX',
      signingTime: at,
      subFilter: SUBFILTER_ETSI_CADES_DETACHED,
      signatureLength: 16384,
      appName: 'Prestige',
    });
    const signer = new P12Signer(material.p12, { passphrase: material.passphrase });
    const signedPdf = await new SignPdf().sign(withPlaceholder, signer, at);
    return this.result(command, material, signedPdf);
  }

  /**
   * 2.ª y siguientes firmas DIGITAL: actualización incremental sobre el PDF ya
   * firmado. Garantiza (y verifica) que los bytes previos quedan intactos, de
   * modo que el ByteRange de las firmas anteriores sigue siendo válido. Si no se
   * puede garantizar, FALLA de forma explícita en vez de invalidarlas en silencio.
   */
  private async signIncremental(
    command: SignCommand,
    material: Awaited<ReturnType<KeyCustodian['getSigningMaterial']>>,
    at: Date,
  ): Promise<SignResult> {
    const original = command.pdfBytes;
    let signedPdf: Buffer;
    try {
      const withPlaceholder = plainAddPlaceholder({
        pdfBuffer: original,
        reason: 'Firma electrónica — Prestige (SeguriData)',
        contactInfo: command.signerId,
        name: command.signerName ?? command.signerId,
        location: 'MX',
        signingTime: at,
        subFilter: SUBFILTER_ETSI_CADES_DETACHED,
        signatureLength: 16384,
        appName: 'Prestige',
      });
      const signer = new P12Signer(material.p12, { passphrase: material.passphrase });
      signedPdf = await new SignPdf().sign(withPlaceholder, signer, at);
    } catch (error) {
      throw new ConflictException({
        error: 'INCREMENTAL_SIGN_UNSUPPORTED',
        message: `No se pudo añadir otra firma digital sin invalidar las anteriores: ${(error as Error).message}`,
      });
    }
    if (signedPdf.length <= original.length || !signedPdf.subarray(0, original.length).equals(original)) {
      throw new ConflictException({
        error: 'INCREMENTAL_SIGN_UNSUPPORTED',
        message: 'La firma adicional modificaría bytes ya firmados; se rechaza para no invalidar las firmas previas',
      });
    }
    return this.result(command, material, signedPdf);
  }

  private result(
    command: SignCommand,
    material: Awaited<ReturnType<KeyCustodian['getSigningMaterial']>>,
    signedPdf: Buffer,
  ): SignResult {
    const signatureHash = createHash('sha256').update(signedPdf).digest('hex');
    this.log.log(
      `PAdES firmado por ${command.signerId} (cert ${material.certificate.serialNumber.slice(0, 16)}…)`,
    );

    return {
      algorithm: 'SHA256withRSA · PAdES-B (ETSI.CAdES.detached)',
      provider: `prestige-pki-${this.custodian.kind}`,
      signatureHash,
      signedPdf,
      certificate: material.certificate,
    };
  }

  async verify(pdfBytes: Buffer): Promise<VerifyResult> {
    try {
      const { signature, signedData } = extractSignature(pdfBytes);
      if (!signature || !signedData?.length) {
        return { valid: false, reason: 'El PDF no contiene una firma PAdES', signatures: 0 };
      }
      // La presencia de un PKCS#7 sobre un ByteRange coherente es la
      // comprobación estructural. La validación criptográfica completa
      // (cadena + integridad) la hace el verificador offline (M11).
      return { valid: true, signatures: 1 };
    } catch (error) {
      return { valid: false, reason: (error as Error).message, signatures: 0 };
    }
  }
}
