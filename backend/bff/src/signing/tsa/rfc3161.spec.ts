import { createHash } from 'node:crypto';
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
});
