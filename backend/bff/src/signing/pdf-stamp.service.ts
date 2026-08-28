import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';

/** Recuadro de firma del contrato de prueba (coords PDF, origen abajo-izquierda). */
export const DEFAULT_SIGNATURE_BOX = {
  page: 1,
  pdfX: 72,
  pdfY: 118,
  pdfW: 300,
  pdfH: 86,
};

export function boxToFieldPct(pageW: number, pageH: number, box = DEFAULT_SIGNATURE_BOX) {
  return {
    page: box.page,
    xPct: box.pdfX / pageW,
    yPct: (pageH - box.pdfY - box.pdfH) / pageH,
    widthPct: box.pdfW / pageW,
    heightPct: box.pdfH / pageH,
  };
}

@Injectable()
export class PdfStampService {
  private readonly log = new Logger(PdfStampService.name);

  async stampAutograph(
    pdfBase64: string,
    pngBase64: string,
    field?: { page: number; xPct: number; yPct: number; widthPct: number; heightPct: number },
  ): Promise<string> {
    try {
      const pdf = await PDFDocument.load(Buffer.from(pdfBase64, 'base64'));
      const png = await pdf.embedPng(Buffer.from(pngBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
      const pages = pdf.getPages();
      const pageIndex = Math.min(Math.max((field?.page ?? 1) - 1, 0), pages.length - 1);
      const page = pages[pageIndex];
      const { width, height } = page.getSize();

      const pct = field ?? boxToFieldPct(width, height);
      const boxW = pct.widthPct * width;
      const boxH = pct.heightPct * height;
      const boxX = pct.xPct * width;
      const boxY = height - pct.yPct * height - boxH;

      const imgAspect = png.width / png.height;
      const boxAspect = boxW / Math.max(boxH, 1);
      const pad = Math.min(boxW, boxH) * 0.08;
      const innerW = Math.max(boxW - pad * 2, 8);
      const innerH = Math.max(boxH - pad * 2, 8);
      let drawW: number;
      let drawH: number;
      if (imgAspect > boxAspect) {
        drawW = innerW;
        drawH = drawW / imgAspect;
      } else {
        drawH = innerH;
        drawW = drawH * imgAspect;
      }
      const drawX = boxX + (boxW - drawW) / 2;
      const drawY = boxY + (boxH - drawH) / 2;

      this.log.log(
        `Autógrafa en recuadro x=${boxX.toFixed(1)} y=${boxY.toFixed(1)} ${boxW.toFixed(1)}×${boxH.toFixed(1)}`,
      );
      page.drawImage(png, { x: drawX, y: drawY, width: drawW, height: drawH });
      const bytes = await pdf.save();
      return Buffer.from(bytes).toString('base64');
    } catch (error) {
      this.log.warn(`No se pudo incrustar la autógrafa: ${(error as Error).message}`);
      return pdfBase64;
    }
  }
}
