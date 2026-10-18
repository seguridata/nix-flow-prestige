import { describe, expect, it } from 'vitest';
import { fixMulterFilename } from './multer-filename';

const asMulter = (s: string) => Buffer.from(s, 'utf8').toString('latin1');

describe('fixMulterFilename', () => {
  it('repara acentos', () => {
    expect(fixMulterFilename(asMulter('Anexo técnico.pdf'))).toBe('Anexo técnico.pdf');
  });
  it('repara ñ', () => {
    expect(fixMulterFilename(asMulter('Contrato año 2026 Peña.pdf'))).toBe('Contrato año 2026 Peña.pdf');
  });
  it('deja intacto un nombre ASCII', () => {
    expect(fixMulterFilename('contrato.pdf')).toBe('contrato.pdf');
  });
  it('no doble-decodifica un nombre ya correcto', () => {
    expect(fixMulterFilename('Anexo técnico.pdf')).toBe('Anexo técnico.pdf');
    expect(fixMulterFilename('año.pdf')).toBe('año.pdf');
    expect(fixMulterFilename('contrato 日本.pdf')).toBe('contrato 日本.pdf');
  });
});
