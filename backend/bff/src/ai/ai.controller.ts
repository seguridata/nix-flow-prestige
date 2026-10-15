import { Body, Controller, Post } from '@nestjs/common';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { AiService, MAX_TEXT, type AiActor } from './ai.service';

class FlowFromTextDto {
  /** El largo mínimo lo valida el servicio con un mensaje en español. */
  @IsString() @MaxLength(MAX_TEXT)
  text!: string;
}

class ReviewFlowDto {
  @IsObject()
  flow!: Record<string, unknown>;

  /** `true` suma la opinión de un modelo a las reglas; cuenta contra la cuota del tenant. */
  @IsOptional() @IsBoolean()
  useAi?: boolean;
}

const actorOf = (u: AuthenticatedUser): AiActor => ({ tenantId: u.tenantId, actorId: u.actorId, name: u.name });

/**
 * IA asistida para administradores. Ninguna ruta guarda ni publica: devuelven una propuesta para
 * revisar y, si conviene, crear como borrador con las rutas de `process-definitions`.
 */
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Roles('admin')
  @Post('flows/from-text')
  fromText(@Body() body: FlowFromTextDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ai.flowFromText(actorOf(user), body.text);
  }

  @Roles('admin')
  @Post('flows/review')
  review(@Body() body: ReviewFlowDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ai.review(actorOf(user), body.flow, body.useAi === true);
  }
}
