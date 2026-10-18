import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { AI_THROTTLE } from '../common/throttle-tracker';
import { CORRELATION_HEADER, resolveCorrelationId } from '../common/log-context';
import { ChatRequestDto, SaveDraftDto } from './chat.dto';
import { ChatService, type ChatActor } from './chat.service';

type ReqLike = { id?: unknown; headers?: Record<string, unknown> };

const actorOf = (u: AuthenticatedUser, req: ReqLike): ChatActor => ({
  tenantId: u.tenantId,
  actorId: u.actorId,
  name: u.name,
  correlationId: typeof req.id === 'string' && req.id ? req.id : resolveCorrelationId(req.headers?.[CORRELATION_HEADER]),
});

/**
 * Chat interno de IA. Solo escribe borradores: no hay ninguna ruta de publicar, firmar, enviar ni borrar.
 * Publicar sigue siendo una acción humana por las rutas de `process-definitions` y `document-templates`.
 */
@Controller('chat')
@Throttle(AI_THROTTLE)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** Responde y, si corresponde, devuelve propuestas ya validadas. No guarda nada. */
  @Roles('admin')
  @Post('messages')
  message(@Body() body: ChatRequestDto, @CurrentUser() user: AuthenticatedUser, @Req() req: ReqLike) {
    return this.chat.converse(actorOf(user, req), body.message, body.history, body.conversationId);
  }

  /** Guarda una propuesta como borrador (flujo sin publicar o borrador de formato). */
  @Roles('admin')
  @Post('drafts')
  save(@Body() body: SaveDraftDto, @CurrentUser() user: AuthenticatedUser, @Req() req: ReqLike) {
    return this.chat.saveDraft(actorOf(user, req), body);
  }

  @Roles('admin')
  @Get('drafts/templates')
  templates(@CurrentUser() user: AuthenticatedUser, @Req() req: ReqLike) {
    return this.chat.listTemplateDrafts(actorOf(user, req));
  }
}
