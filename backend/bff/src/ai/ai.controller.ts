import { Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { AiService, MAX_PDF_BYTES, MAX_TEXT, type AiActor } from './ai.service';
import { Throttle } from '@nestjs/throttler';
import { AI_THROTTLE } from '../common/throttle-tracker';

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
@Throttle(AI_THROTTLE)
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

  /** Multipart: `file` (PDF con campos de formulario) y, opcional, `description`. No guarda nada. */
  @Roles('admin')
  @Post('templates/from-pdf')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES } }))
  templateFromPdf(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('description') description: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ai.templateFromPdf(actorOf(user), file?.buffer, typeof description === 'string' ? description : '');
  }
}
