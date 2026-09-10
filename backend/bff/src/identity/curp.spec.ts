import { describe, expect, it } from 'vitest';
import { curpCheckDigit, parseCurp } from './curp';

function withCheck(base17: string): string {
  return base17 + String(curpCheckDigit(base17));
}

describe('CURP (M16)', () => {
  it('valida una CURP bien formada con dígito verificador correcto', () => {
    const full = withCheck('MEXR850101HDFLNS0'); // hombre, 1985-01-01, DF
    const p = parseCurp(full);
    expect(p.valid).toBe(true);
    expect(p.reasons).toEqual([]);
    expect(p.sex).toBe('H');
    expect(p.birthDate).toBe('1985-01-01');
    expect(p.state).toBe('DF');
  });

  it('rechaza vacío, longitud y dígito verificador incorrecto', () => {
    expect(parseCurp('').valid).toBe(false);
    expect(parseCurp('ABC').reasons.some((r) => /longitud/.test(r))).toBe(true);

    const good = withCheck('MEXR850101HDFLNS0');
    const tampered = good.slice(0, 17) + (good[17] === '0' ? '1' : '0');
    expect(parseCurp(tampered).reasons.some((r) => /dígito verificador/.test(r))).toBe(true);
  });

  it('infiere el siglo por el homoclave (letra → 2000+)', () => {
    const p = parseCurp(withCheck('MEXR050101MDFLNSA'));
    expect(p.birthDate?.startsWith('2005')).toBe(true);
    expect(p.sex).toBe('M');
  });
});
