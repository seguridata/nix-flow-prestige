import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { EvidenceService } from './evidence.service';

@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Public()
  @Get('by-request/:signatureRequestId')
  byRequest(@Param('signatureRequestId') signatureRequestId: string) {
    return this.evidence.findByRequest(signatureRequestId);
  }

  @Public()
  @Get(':manifestId')
  byManifestId(@Param('manifestId') manifestId: string) {
    return this.evidence.findByManifestId(manifestId);
  }

  @Public()
  @Get(':manifestId/verify')
  verify(@Param('manifestId') manifestId: string) {
    return this.evidence.verify(manifestId);
  }
}
