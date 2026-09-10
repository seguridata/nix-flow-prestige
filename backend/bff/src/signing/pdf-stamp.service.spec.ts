import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { boxToFieldPct, DEFAULT_SIGNATURE_BOX, PdfStampService } from './pdf-stamp.service';

describe('boxToFieldPct', () => {
  it('convierte el recuadro PDF al porcentaje desde arriba y vuelve al origen', () => {
    const pageW = 612;
    const pageH = 792;
    const pct = boxToFieldPct(pageW, pageH);
    expect(pct.page).toBe(1);
    const boxY = pageH - pct.yPct * pageH - pct.heightPct * pageH;
    expect(boxY).toBeCloseTo(DEFAULT_SIGNATURE_BOX.pdfY, 5);
    expect(pct.xPct * pageW).toBeCloseTo(DEFAULT_SIGNATURE_BOX.pdfX, 5);
    expect(pct.widthPct * pageW).toBeCloseTo(DEFAULT_SIGNATURE_BOX.pdfW, 5);
    expect(pct.heightPct * pageH).toBeCloseTo(DEFAULT_SIGNATURE_BOX.pdfH, 5);
  });
});

describe('PdfStampService', () => {
  it('incrusta la imagen dentro del recuadro por defecto', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    page.drawRectangle({
      x: DEFAULT_SIGNATURE_BOX.pdfX,
      y: DEFAULT_SIGNATURE_BOX.pdfY,
      width: DEFAULT_SIGNATURE_BOX.pdfW,
      height: DEFAULT_SIGNATURE_BOX.pdfH,
    });
    // PNG 1x1
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const original = Buffer.from(await pdf.save());
    const service = new PdfStampService();
    const stamped = await service.stampAutograph(original, pngBytes);
    expect(Buffer.isBuffer(stamped)).toBe(true);
    expect(stamped.length).toBeGreaterThan(80);
    expect(stamped.equals(original)).toBe(false);
  });
});
