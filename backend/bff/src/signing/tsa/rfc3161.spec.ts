import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { describe, expect, it } from 'vitest';
import { requestTimestamp, verifyTimestampToken } from './rfc3161';

/**
 * Sello de tiempo RFC 3161 real contra una TSA pública. Se salta si no hay
 * red o `TSA_URL` no está definido (el CI sin salida a internet no debe
 * romper). No es un mock: si corre, valida el flujo ASN.1 completo.
 */
const TSA = process.env.TSA_URL ?? 'https://freetsa.org/tsr';

describe('RFC 3161 — sello de tiempo real', () => {
  it('obtiene y verifica un TimeStampToken sobre un hash', async () => {
    process.env.TSA_URL = TSA;
    const hash = createHash('sha256').update('expediente-prestige-' + Date.now()).digest();

    let result: Awaited<ReturnType<typeof requestTimestamp>>;
    try {
      result = await requestTimestamp(hash);
    } catch (err) {
      const msg = (err as Error).message;
      // Sin red: se acepta como "omitido". Cualquier otro error DEBE fallar el test.
      if (/fetch failed|ENOTFOUND|ECONNREFUSED|timed out|network/i.test(msg)) {
        console.warn(`[tsa] omitido (sin red): ${msg}`);
        return;
      }
      throw err;
    }
    if (!result) throw new Error('requestTimestamp devolvió null con TSA_URL definido');

    expect(result.token.length).toBeGreaterThan(500);
    expect(result.info.genTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.info.hashedMessage.equals(hash)).toBe(true);

    const check = verifyTimestampToken(result.token, hash);
    expect(check.valid).toBe(true);
    expect(check.genTime).toBe(result.info.genTime);

    // Un hash distinto debe fallar la verificación.
    const other = createHash('sha256').update('otro').digest();
    expect(verifyTimestampToken(result.token, other).valid).toBe(false);
  }, 20_000);

  it('rechaza un TimeStampToken con la firma CMS falsificada (hashedMessage correcto, firma inválida)', async () => {
    process.env.TSA_URL = TSA;
    const hash = createHash('sha256').update('expediente-forjado-' + Date.now()).digest();

    let result: Awaited<ReturnType<typeof requestTimestamp>>;
    try {
      result = await requestTimestamp(hash);
    } catch (err) {
      const msg = (err as Error).message;
      if (/fetch failed|ENOTFOUND|ECONNREFUSED|timed out|network/i.test(msg)) {
        console.warn(`[tsa] omitido (sin red): ${msg}`);
        return;
      }
      throw err;
    }
    if (!result) throw new Error('requestTimestamp devolvió null con TSA_URL definido');

    // El token real, sin tocar, debe ser válido — confirma que el ataque de
    // abajo realmente corrompe algo y no es un falso negativo por accidente.
    expect(verifyTimestampToken(result.token, hash).valid).toBe(true);

    // Ataque: se toma el TimeStampToken CMS real (con el hashedMessage
    // correcto) y se corrompe únicamente el último byte de la firma
    // (SignerInfo.encryptedDigest). El hash sellado sigue coincidiendo con
    // el esperado — solo la verificación criptográfica de la firma puede
    // detectar la falsificación.
    const { asn1 } = forge;
    const root = asn1.fromDer(result.token.toString('binary'));
    const sd = (root.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[];
    const sdValue = sd[0].value as forge.asn1.Asn1[];
    const signerInfosSet = sdValue[sdValue.length - 1];
    const signerInfo = (signerInfosSet.value as forge.asn1.Asn1[])[0];
    const sigNode = (signerInfo.value as forge.asn1.Asn1[]).find(
      (f) => f.tagClass === asn1.Class.UNIVERSAL && f.type === asn1.Type.OCTETSTRING,
    );
    if (!sigNode) throw new Error('No se encontró el nodo de firma (encryptedDigest) en el SignerInfo');
    const sigBytes = sigNode.value as string;
    const lastByte = sigBytes.charCodeAt(sigBytes.length - 1);
    sigNode.value = sigBytes.slice(0, -1) + String.fromCharCode(lastByte ^ 0xff);

    const forgedToken = Buffer.from(asn1.toDer(root).getBytes(), 'binary');

    const check = verifyTimestampToken(forgedToken, hash);
    expect(check.valid).toBe(false);
    expect(check.signatureVerified).toBe(false);
  }, 20_000);
});
