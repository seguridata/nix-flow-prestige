import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { CasesService } from '../cases/cases.service';
import { DocumentsService } from '../documents/documents.service';
import { SignatureRequestsService } from '../signature-requests/signature-requests.service';
import { SignatureFieldsService } from '../signature-fields/signature-fields.service';
import { boxToFieldPct, DEFAULT_SIGNATURE_BOX } from '../signing/pdf-stamp.service';

@Injectable()
export class DemoService {
  constructor(
    private readonly cases: CasesService,
    private readonly documents: DocumentsService,
    private readonly signatureRequests: SignatureRequestsService,
    private readonly fields: SignatureFieldsService,
  ) {}

  async createSelfSign(body: { signerId: string; name: string; email?: string }) {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    page.drawText('Prestige — Contrato de prueba', {
      x: 72,
      y: 720,
      size: 18,
      font: bold,
      color: rgb(0.1, 0.1, 0.1),
    });
    page.drawText(`Firmante: ${body.name}`, { x: 72, y: 680, size: 12, font });
    page.drawText('Documento generado para ejercitar la ceremonia de firma.', {
      x: 72,
      y: 656,
      size: 11,
      font,
    });
    page.drawText('Firme DENTRO del recuadro verde. El trazo se incrusta ahi, no al margen.', {
      x: 72,
      y: 638,
      size: 11,
      font,
    });
    page.drawRectangle({
      x: DEFAULT_SIGNATURE_BOX.pdfX,
      y: DEFAULT_SIGNATURE_BOX.pdfY,
      width: DEFAULT_SIGNATURE_BOX.pdfW,
      height: DEFAULT_SIGNATURE_BOX.pdfH,
      color: rgb(0.96, 0.98, 0.9),
      borderColor: rgb(0.52, 0.74, 0),
      borderWidth: 1.5,
    });
    page.drawText('FIRME DENTRO DE ESTE RECUADRO', {
      x: DEFAULT_SIGNATURE_BOX.pdfX + 10,
      y: DEFAULT_SIGNATURE_BOX.pdfY + DEFAULT_SIGNATURE_BOX.pdfH - 14,
      size: 9,
      font,
      color: rgb(0.36, 0.4, 0.44),
    });
    const contentBase64 = Buffer.from(await pdf.save()).toString('base64');

    const kase = await this.cases.create({
      tenantId: 'seguridata',
      title: `Prueba de firma — ${body.name}`,
    });
    const document = await this.documents.create({
      caseId: kase.id,
      filename: 'contrato-prueba.pdf',
      contentBase64,
    });
    const request = await this.signatureRequests.create({
      documentId: document.id,
      methods: ['AUTOGRAFA', 'DIGITAL'],
      order: 'SECUENCIAL',
      requestedBy: body.signerId,
      requestedByName: body.name,
      signers: [
        {
          signerId: body.signerId,
          name: body.name,
          email: body.email,
          role: 'FIRMANTE',
        },
      ],
    });
    const pct = boxToFieldPct(612, 792, DEFAULT_SIGNATURE_BOX);
    await this.fields.create({
      documentId: document.id,
      signerId: body.signerId,
      type: 'SIGNATURE',
      ...pct,
      required: true,
    });
    return { case: kase, document, request };
  }
}
