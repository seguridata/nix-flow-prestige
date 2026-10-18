import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import forge from 'node-forge';
import { extractSignature } from '@signpdf/utils';
import { DigitalSignerAdapter, countSignatures } from './digital.adapter';
import { PdfStampService } from './pdf-stamp.service';
import type { KeyCustodian } from './pki/key-custodian';
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
      tenantId: 'seguridata',
      signatureRequestId: 'sr-1',
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
      tenantId: 'seguridata',
      signatureRequestId: 'sr-1',
      documentHash: 'h',
      pdfBytes: pdf,
    });
    await expect(adapter.verify(signed.signedPdf!)).resolves.toMatchObject({ valid: true, signatures: 1 });
    await expect(adapter.verify(pdf)).resolves.toMatchObject({ valid: false, signatures: 0 });
  });

  it('multi-firma en serie: la 2.ª firma DIGITAL es una actualización incremental que no toca los bytes de la 1.ª', async () => {
    const pdf = await minimalPdf();
    const base = {
      method: 'DIGITAL' as const,
      documentId: 'doc-1',
      tenantId: 'seguridata',
      signatureRequestId: 'sr-1',
      documentHash: 'abc',
      field: { page: 1, xPct: 0.1, yPct: 0.8, widthPct: 0.4, heightPct: 0.1 },
    };
    const first = await adapter.sign({ ...base, signerId: 'ana@x.mx', signerName: 'Ana', pdfBytes: pdf });
    const second = await adapter.sign({
      ...base,
      signerId: 'beto@x.mx',
      signerName: 'Beto',
      pdfBytes: first.signedPdf!,
    });
    const third = await adapter.sign({
      ...base,
      signerId: 'carla@x.mx',
      signerName: 'Carla',
      pdfBytes: second.signedPdf!,
    });

    expect(countSignatures(first.signedPdf!)).toBe(1);
    expect(countSignatures(second.signedPdf!)).toBe(2);
    expect(countSignatures(third.signedPdf!)).toBe(3);
    // Propiedad que preserva el ByteRange previo: el PDF anterior es PREFIJO exacto del nuevo.
    expect(second.signedPdf!.subarray(0, first.signedPdf!.length).equals(first.signedPdf!)).toBe(true);
    expect(third.signedPdf!.subarray(0, second.signedPdf!.length).equals(second.signedPdf!)).toBe(true);
    expect(second.certificate?.subject).toContain('Beto');
  });

  it('si no puede garantizar la actualización incremental, falla explícitamente (no invalida en silencio)', async () => {
    // Parece firmado (ByteRange con enteros) pero no es un PDF anexable.
    const fake = Buffer.from(['%PDF-1.7', '/ByteRange [0 10 20 30]', '%%EOF'].join('\n'));
    await expect(
      adapter.sign({
        method: 'DIGITAL',
        signerId: 'x',
        documentId: 'd',
        tenantId: 'seguridata',
        signatureRequestId: 'sr-1',
        documentHash: 'h',
        pdfBytes: fake,
      }),
    ).rejects.toMatchObject({ response: { error: 'INCREMENTAL_SIGN_UNSUPPORTED' } });
  });

  it('firma contra un custodio PKCS#11 que no entrega la llave', async () => {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = 'aa';
    cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
    cert.validity.notAfter = new Date('2027-01-01T00:00:00Z');
    cert.setSubject([{ name: 'commonName', value: 'Sello HSM' }]);
    cert.setIssuer([{ name: 'commonName', value: 'PSC' }]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const custodian: KeyCustodian = {
      kind: 'pkcs11',
      async getSigningMaterial() {
        return {
          certificatePem: forge.pki.certificateToPem(cert),
          certificate: {
            serialNumber: cert.serialNumber,
            subject: 'CN=Sello HSM',
            issuer: 'CN=PSC',
            notBefore: cert.validity.notBefore.toISOString(),
            notAfter: cert.validity.notAfter.toISOString(),
          },
          signRsaPkcs1: (digestInfo) =>
            Buffer.from(keys.privateKey.sign(digestInfo.toString('binary'), 'NONE'), 'binary'),
        };
      },
    };
    const tokenAdapter = new DigitalSignerAdapter(custodian, new PdfStampService());
    const pdf = await minimalPdf();
    const result = await tokenAdapter.sign({
      method: 'DIGITAL',
      signerId: 'sello',
      signerName: 'Sello',
      documentId: 'doc-1',
      tenantId: 'seguridata',
      signatureRequestId: 'sr-1',
      documentHash: 'abc',
      pdfBytes: pdf,
    });
    expect(result.provider).toBe('prestige-pki-pkcs11');
    expect(result.signedPdf!.toString('latin1')).toContain('/ETSI.CAdES.detached');
    const { signature } = extractSignature(result.signedPdf!);
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(Buffer.from(signature, 'binary').toString('binary')));
    const embedded = (p7 as unknown as { certificates: forge.pki.Certificate[] }).certificates;
    expect(embedded.some((item) => item.subject.getField('CN')?.value === 'Sello HSM')).toBe(true);
  });
});
