import { Module } from '@nestjs/common';
import { EvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';
import { ManifestSigner } from './manifest-signer';

@Module({
  controllers: [EvidenceController],
  providers: [EvidenceService, ManifestSigner],
  exports: [EvidenceService, ManifestSigner],
})
export class EvidenceModule {}
