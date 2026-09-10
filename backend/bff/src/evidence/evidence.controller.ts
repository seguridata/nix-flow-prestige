import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ZipArchive } from 'archiver';
import { Public } from '../auth/public.decorator';
import { EvidenceService } from './evidence.service';

@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  /** Expediente probatorio completo en ZIP (PDF firmado + manifiesto + verificador offline). */
  @Get(':manifestId/dossier')
  async dossier(@Param('manifestId') manifestId: string, @Res() res: Response): Promise<void> {
    const { files } = await this.evidence.buildDossier(manifestId);

    const zip = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    zip.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      zip.on('end', () => resolve(Buffer.concat(chunks)));
      zip.on('error', reject);
    });
    for (const f of files) zip.append(f.content, { name: f.path });
    await zip.finalize();
    const body = await done;

    res
      .status(200)
      .setHeader('Content-Type', 'application/zip')
      .setHeader('Content-Length', body.length)
      .setHeader('Content-Disposition', `attachment; filename="expediente-${manifestId}.zip"`)
      .end(body);
  }

  @Get('by-request/:signatureRequestId')
  byRequest(@Param('signatureRequestId') signatureRequestId: string) {
    return this.evidence.findByRequest(signatureRequestId);
  }

  @Get(':manifestId')
  byManifestId(@Param('manifestId') manifestId: string) {
    return this.evidence.findByManifestId(manifestId);
  }

  /**
   * Verificador público: cualquiera puede recalcular la cadena de un
   * manifiesto a partir de su id. No expone PII ni el contenido del documento,
   * solo `{ valid, mismatches }`.
   */
  @Public()
  @Get(':manifestId/verify')
  verify(@Param('manifestId') manifestId: string) {
    return this.evidence.verify(manifestId);
  }
}
