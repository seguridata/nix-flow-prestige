import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { TemplateField } from './template.types';

/** Helvetica solo codifica WinAnsi: lo que no cabe se cambia por «?» en vez de romper el documento. */
export function sanitizeWinAnsi(font: PDFFont, text: string): string {
  const flat = text.replace(/[\r\n\t]+/g, ' ');
  let out = '';
  for (const ch of flat) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

/** AAAA-MM-DD → DD/MM/AAAA; el resto pasa igual. */
export function formatFieldValue(type: TemplateField['type'], raw: string): string {
  if (type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [y, m, d] = raw.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  return raw;
}

/**
 * Imprime los valores en las cajas del PDF base. Las coordenadas son fracciones con origen
 * arriba-izquierda; pdf-lib dibuja desde abajo. El texto se reduce (mínimo 6 pt) hasta caber en la
 * caja y, si aun así no cabe, se recorta con «…».
 */
export async function fillPdf(
  base: Buffer,
  fields: TemplateField[],
  values: Record<string, string>,
): Promise<Buffer> {
  const pdf = await PDFDocument.load(base, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  for (const field of fields) {
    const raw = values[field.key];
    if (raw === undefined || raw === '') continue;
    const page = pages[field.page - 1];
    if (!page) continue;
    const { width, height } = page.getSize();
    const boxW = field.w * width;
    const boxH = field.h * height;

    let text = sanitizeWinAnsi(font, formatFieldValue(field.type, raw));
    let size = Math.min(field.fontSize ?? 11, Math.max(boxH * 0.8, 6));
    while (size > 6 && font.widthOfTextAtSize(text, size) > boxW) size -= 0.5;
    if (font.widthOfTextAtSize(text, size) > boxW) {
      while (text.length > 1 && font.widthOfTextAtSize(`${text}…`, size) > boxW) text = text.slice(0, -1);
      text = sanitizeWinAnsi(font, `${text}…`);
    }

    const textW = font.widthOfTextAtSize(text, size);
    const x = field.x * width + (field.align === 'center' ? Math.max((boxW - textW) / 2, 0) : 0);
    // Línea base centrada verticalmente en la caja.
    const yTop = height - field.y * height;
    const y = yTop - boxH / 2 - size * 0.35;
    page.drawText(text, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) });
  }

  // Sin object streams: PDF clásico, más simple de firmar de forma incremental (PAdES) después.
  return Buffer.from(await pdf.save({ useObjectStreams: false }));
}

export async function countPages(bytes: Buffer): Promise<number> {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return pdf.getPageCount();
}
