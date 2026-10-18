import { describe, expect, it } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { AutographSignerAdapter } from './autograph.adapter';
import { PdfStampService } from './pdf-stamp.service';
import type { SignCommand } from './signer-adapter';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function basePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  return Buffer.from(await pdf.save());
}

const cmd = (pdfBytes: Buffer): SignCommand =>
  ({ pdfBytes, signatureImage: png, documentHash: 'h', signerId: 's' }) as unknown as SignCommand;

describe('AutographSignerAdapter', () => {
  const adapter = new AutographSignerAdapter(new PdfStampService());

  it('PDF sin firma + AUTOGRAFA: estampa el trazo', async () => {
    const original = await basePdf();
    const res = await adapter.sign(cmd(original));
    expect(res.signedPdf!.equals(original)).toBe(false);
  });

  it('PDF con firma PAdES previa + AUTOGRAFA: 409 VISUAL_STAMP_AFTER_SIGNATURE_UNSUPPORTED', async () => {
    const signed = Buffer.concat([await basePdf(), Buffer.from('\n/ByteRange [0 10 20 30]\n')]);
    await expect(adapter.sign(cmd(signed))).rejects.toBeInstanceOf(ConflictException);
  });

  it('un error de estampado se propaga (no se firma sin trazo visible)', async () => {
    await expect(adapter.sign(cmd(Buffer.from('basura')))).rejects.toBeDefined();
  });
});
