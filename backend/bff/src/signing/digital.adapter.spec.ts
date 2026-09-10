import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import forge from 'node-forge';
import { extractSignature } from '@signpdf/utils';
import { DigitalSignerAdapter } from './digital.adapter';
import { PdfStampService } from './pdf-stamp.service';
import { SoftwareKeyCustodian } from './pki/software-key-custodian';
import type { SignCommand } from './signer-adapter';

async function minimalPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawText('Contrato de prueba — Prestige', { x: 60, y: 700, size: 14 });
  return Buffer.from(await pdf.save());
}

describe('DigitalSignerAdapter — PAdES real', () => {
  let adapter: DigitalSignerAdapter;

  beforeAll(() => {
    const pkiDir = mkdtempSync(join(tmpdir(), 'prestige-pki-'));
    process.env.PKI_DIR = pkiDir;
    process.env.PKI_PASSPHRASE = 'test-pass';
    adapter = new DigitalSignerAdapter(new SoftwareKeyCustodian(), new PdfStampService());
  });

  it('emite un certificado X.509 y embebe un PKCS#7 CAdES-detached verificable', async () => {
    const pdf = await minimalPdf();
    const cmd: SignCommand = {
      method: 'DIGITAL',
      signerId: 'ana@seguridata.mx',
      signerName: 'Ana Prueba',
      documentId: 'doc-1',
      documentHash: 'abc',
      pdfBytes: pdf,
      field: { page: 1, xPct: 0.1, yPct: 0.8, widthPct: 0.4, heightPct: 0.1 },
    };

    const result = await adapter.sign(cmd);

    expect(Buffer.isBuffer(result.signedPdf)).toBe(true);
    expect(result.signedPdf!.length).toBeGreaterThan(pdf.length);
    const text = result.signedPdf!.toString('latin1');
    expect(text).toContain('/ByteRange');
    expect(text).toContain('/ETSI.CAdES.detached');
    expect(text).toContain('/Type /Sig');

    // El certificado devuelto es real y coherente.
    expect(result.certificate?.serialNumber).toMatch(/^[0-9a-f]+$/i);
    expect(result.certificate?.subject).toContain('Ana Prueba');
    expect(result.certificate?.issuer).toContain('Prestige Issuing CA');

    // El PKCS#7 embebido se parsea y contiene el certificado del firmante,
    // emitido por nuestra CA.
    const { signature } = extractSignature(result.signedPdf!);
    const p7Der = Buffer.from(signature, 'binary');
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(p7Der.toString('binary')));
    const certs = (p7 as unknown as { certificates: forge.pki.Certificate[] }).certificates;
    expect(certs.length).toBeGreaterThanOrEqual(2); // hoja + intermedia (+ raíz)
    const leaf = certs.find((c) => c.subject.getField('OU')?.value === 'Prestige Firmantes');
    expect(leaf).toBeDefined();
    expect(leaf!.subject.getField('CN')?.value).toBe('Ana Prueba');
    expect(leaf!.issuer.getField('CN')?.value).toBe('Prestige Issuing CA');
  });

  it('verify() reconoce el PDF firmado y rechaza uno sin firma', async () => {
    const pdf = await minimalPdf();
    const signed = await adapter.sign({
      method: 'DIGITAL',
      signerId: 'x',
      documentId: 'd',
      documentHash: 'h',
      pdfBytes: pdf,
    });
    await expect(adapter.verify(signed.signedPdf!)).resolves.toMatchObject({ valid: true, signatures: 1 });
    await expect(adapter.verify(pdf)).resolves.toMatchObject({ valid: false, signatures: 0 });
  });
});
