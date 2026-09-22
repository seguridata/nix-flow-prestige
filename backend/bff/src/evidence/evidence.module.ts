import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { EvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';
import { ManifestSigner } from './manifest-signer';

@Module({
  imports: [WebhooksModule],
  controllers: [EvidenceController],
  providers: [EvidenceService, ManifestSigner],
  exports: [EvidenceService, ManifestSigner],
})
export class EvidenceModule {}
