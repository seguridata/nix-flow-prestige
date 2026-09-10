import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { EvidenceService } from './evidence.service';

@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

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
