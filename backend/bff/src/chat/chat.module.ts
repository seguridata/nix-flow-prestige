import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ProcessModule } from '../process/process.module';
import { ChatController } from './chat.controller';
import { ChatDraftsStore } from './chat-drafts.store';
import { ChatService } from './chat.service';

@Module({
  imports: [AiModule, ProcessModule],
  controllers: [ChatController],
  providers: [ChatService, ChatDraftsStore],
})
export class ChatModule {}
