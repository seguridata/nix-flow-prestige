/**
 * multer decodifica `file.originalname` como latin1 aunque el navegador lo envíe
 * en UTF-8 ("Anexo técnico.pdf" llega como "Anexo tÃ©cnico.pdf"). Revierte ese
 * mojibake: reinterpreta los bytes latin1 como UTF-8 SOLO si el original tiene
 * caracteres 0x80-0xFF y el resultado es UTF-8 válido (sin U+FFFD). Un nombre
 * ASCII o ya correcto ("técnico", con chars > 0xFF o no decodificable) no se toca.
 */
export function fixMulterFilename(name: string): string {
  if (!/[\u0080-ÿ]/.test(name)) return name;
  // Si ya trae caracteres fuera de latin1 no pasó por la decodificación de multer.
  if (/[^\u0000-ÿ]/.test(name)) return name;
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}
