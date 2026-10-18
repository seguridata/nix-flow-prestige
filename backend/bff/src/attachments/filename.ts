import { fixMulterFilename } from '../documents/multer-filename';

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * Nombre de archivo seguro para guardar y servir: sin rutas, sin caracteres de control ni de dirección de texto
 * (RLO y similares), sin puntos internos (no hay «factura.exe.pdf»), acentos conservados y con la extensión del
 * tipo REAL detectado (`ext`), no la que mandó el cliente.
 */
export function sanitizeFilename(original: string | undefined, ext: string): string {
  let name = original ? fixMulterFilename(original) : '';
  name = name.split(/[\\/]/).pop() ?? '';
  name = name
    .normalize('NFC')
    // control, bidi, ancho cero, BOM
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const dot = name.lastIndexOf('.');
  let base = dot > 0 ? name.slice(0, dot) : name;
  base = base.replace(/\./g, '_').replace(/^[\s._-]+|[\s._]+$/g, '');
  base = [...base].slice(0, 100).join('').trim();
  if (!base) base = 'anexo';
  if (RESERVED.test(base)) base = `_${base}`;
  return `${base}.${ext}`;
}
