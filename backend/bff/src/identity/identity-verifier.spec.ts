import { describe, expect, it } from 'vitest';
import { HeuristicIdentityVerifier } from './identity-verifier';
import { curpCheckDigit } from './curp';
import type { IneOcrResult } from './ocr.service';

const CURP = 'MEXR850101HDFLNS0' + String(curpCheckDigit('MEXR850101HDFLNS0'));
const nextYear = String(new Date().getFullYear() + 3);
const lastYear = String(new Date().getFullYear() - 1);

function ocr(fields: Partial<IneOcrResult['fields']>, confidence = 80): IneOcrResult {
  return { engine: 'tesseract.js', lang: 'spa', confidence, fields };
}

describe('HeuristicIdentityVerifier (M16)', () => {
  const v = new HeuristicIdentityVerifier();

  it('ok cuando CURP válida, vigente y coincide con lo declarado', async () => {
    const r = await v.verify({
      declaredCurp: CURP,
      ocr: ocr({ curp: CURP, vigencia: nextYear }),
    });
    expect(r.ok).toBe(true);
    expect(r.score).toBe(1);
    expect(r.fields.curpMatches).toBe(true);
    expect(r.fields.vigente).toBe(true);
  });

  it('no ok si la INE está vencida', async () => {
    const r = await v.verify({ declaredCurp: CURP, ocr: ocr({ curp: CURP, vigencia: lastYear }) });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => /vencida/.test(x))).toBe(true);
  });

  it('no ok si la CURP de la INE no coincide con la declarada', async () => {
    const other = 'XEXR850101HDFLNS0' + String(curpCheckDigit('XEXR850101HDFLNS0'));
    const r = await v.verify({ declaredCurp: CURP, ocr: ocr({ curp: other, vigencia: nextYear }) });
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => /no coincide/.test(x))).toBe(true);
  });

  it('sin OCR usa la CURP declarada y marca baja confianza', async () => {
    const r = await v.verify({ declaredCurp: CURP, ocr: null });
    expect(r.fields.curpValid).toBe(true);
    expect(r.reasons.some((x) => /vigencia/.test(x))).toBe(true);
  });
});
