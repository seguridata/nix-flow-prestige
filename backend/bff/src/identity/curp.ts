/**
 * M16 — validación estructural de CURP (RENAPO). No consulta a RENAPO: sólo
 * comprueba forma y dígito verificador. La consulta real la hace el puerto
 * `IdentityVerifier` (impl `renapo`).
 */
const CURP_RE = /^[A-Z][AEIOUX][A-Z]{2}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[HM](?:AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;

const DICT = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';

export function curpCheckDigit(curp17: string): number {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const idx = DICT.indexOf(curp17[i]);
    sum += (idx < 0 ? 0 : idx) * (18 - i);
  }
  const d = 10 - (sum % 10);
  return d === 10 ? 0 : d;
}

export interface CurpParse {
  valid: boolean;
  reasons: string[];
  birthDate?: string;
  sex?: 'H' | 'M';
  state?: string;
}

export function parseCurp(raw: string | null | undefined): CurpParse {
  const curp = (raw ?? '').toUpperCase().trim();
  const reasons: string[] = [];
  if (!curp) return { valid: false, reasons: ['CURP vacía'] };
  if (curp.length !== 18) reasons.push(`longitud ${curp.length} (esperada 18)`);
  if (!CURP_RE.test(curp)) reasons.push('no cumple el patrón RENAPO');
  if (curp.length === 18) {
    const expected = curpCheckDigit(curp.slice(0, 17));
    if (String(expected) !== curp[17]) reasons.push('dígito verificador incorrecto');
  }

  let birthDate: string | undefined;
  let sex: 'H' | 'M' | undefined;
  let state: string | undefined;
  if (curp.length === 18) {
    const yy = Number(curp.slice(4, 6));
    const mm = curp.slice(6, 8);
    const dd = curp.slice(8, 10);
    // El homoclave alfanumérico en pos. 17 es dígito para <2000, letra para >=2000.
    const century = /[A-Z]/.test(curp[16]) ? 2000 : 1900;
    birthDate = `${century + yy}-${mm}-${dd}`;
    sex = curp[10] === 'H' ? 'H' : 'M';
    state = curp.slice(11, 13);
  }

  return { valid: reasons.length === 0, reasons, birthDate, sex, state };
}
