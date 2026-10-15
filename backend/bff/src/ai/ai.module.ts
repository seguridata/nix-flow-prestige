import { Module } from '@nestjs/common';
import { CollaborationModule } from '../collaboration/collaboration.module';
import { AiController } from './ai.controller';
import { AiQuotaService } from './ai-quota.service';
import { AiService } from './ai.service';
import { GrokProvider } from './grok.provider';
import { LLM_PROVIDER } from './llm.types';

/** Para cambiar de proveedor basta con otra implementación de `LlmProvider` en este `useFactory`. */
@Module({
  imports: [CollaborationModule],
  controllers: [AiController],
  providers: [{ provide: LLM_PROVIDER, useFactory: () => new GrokProvider() }, AiQuotaService, AiService],
  exports: [AiService],
})
export class AiModule {}
