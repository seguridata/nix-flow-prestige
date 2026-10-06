import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import forge from 'node-forge';
import { P12Signer } from '@signpdf/signer-p12';
import { buildP12, ensureCaChain, issueLeaf, loadCaChain } from './ca';
import { TokenBackedSigner } from './token-backed-signer';

function certsAndKey(p12: Buffer, passphrase: string) {
  const asn1 = forge.asn1.fromDer(p12.toString('binary'));
  const parsed = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);
  const certBags = parsed.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const keyBags = parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const privateKey = keyBags[0].key!;
  const certificates = certBags.map((bag) => bag.cert!);
  const leaf = certificates.find(
    (cert) => privateKey.n.compareTo(cert.publicKey.n) === 0 && privateKey.e.compareTo(cert.publicKey.e) === 0,
  );
  if (!leaf) throw new Error('el P12 no trae la hoja');
  return { privateKey, certificates, leaf };
}

describe('TokenBackedSigner', () => {
  it('produce el mismo PKCS#7 detached que P12Signer, sin entregar la llave al firmador', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prestige-pki-token-'));
    ensureCaChain(dir);
    const ca = loadCaChain(dir);
    const issued = issueLeaf(ca, { signerId: 'ana@seguridata.mx', commonName: 'Ana Prueba' });
    const passphrase = 'test-pass';
    const p12 = buildP12(issued, ca, passphrase);
    const { privateKey, certificates, leaf } = certsAndKey(p12, passphrase);

    let sawPrivateKey = false;
    const signRsaPkcs1 = (digestInfo: Buffer) => {
      sawPrivateKey = true;
      return Buffer.from(privateKey.sign(digestInfo.toString('binary'), 'NONE'), 'binary');
    };

    const content = Buffer.from('byte-range-del-pdf');
    const at = new Date('2026-10-05T15:00:00Z');
    const fromToken = await new TokenBackedSigner({ certificates, leaf, signRsaPkcs1 }).sign(content, at);
    const fromP12 = await new P12Signer(p12, { passphrase }).sign(content, at);

    expect(sawPrivateKey).toBe(true);
    expect(fromToken.equals(fromP12)).toBe(true);
  });
});
