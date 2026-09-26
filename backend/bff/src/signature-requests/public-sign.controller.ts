import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseFilePipeBuilder,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { OneTimeLinkService } from '../notifications/one-time-link.service';
import { PasskeyCeremonyService } from '../webauthn/passkey-ceremony.service';
import { SignatureRequestsService } from './signature-requests.service';
import { ConsentAcceptDto, PasskeyFinishDto, SignActionDto } from './dto';

const MAX_STROKE_BYTES = 2 * 1024 * 1024;

/**
 * M13 / A-12 — portal del firmante externo. `@Public()` es intencional:
 * el firmante no tiene sesión de Keycloak. La autorización es el enlace de
 * un solo uso (32 bytes, solo su SHA-256 en base, con caducidad). Resolver
 * y registrar consentimiento no lo consumen; la firma sí, y de forma
 * atómica. No es una ruta que haya quedado abierta por ahora.
 *
 * Sprint 6 — límite más estricto que el default global (120/min): esta
 * superficie es no autenticada y atada a un secreto de un solo uso, el
 * blanco natural de fuerza bruta contra el token en la URL.
 */
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('public/links')
export class PublicSignController {
  constructor(
    private readonly links: OneTimeLinkService,
    private readonly signatureRequests: SignatureRequestsService,
    private readonly prisma: PrismaService,
    private readonly passkeys: PasskeyCeremonyService,
  ) {}

  @Public()
  @Get(':token')
  async resolve(@Param('token') token: string) {
    const link = await this.links.resolve(token);
    const request = link.signatureRequestId
      ? await this.prisma.signatureRequest.findUnique({
          where: { id: link.signatureRequestId },
          include: { signers: true, document: true },
        })
      : null;
    const signer = request?.signers.find(
      (s) => s.signerId === link.signerId || s.delegatedTo === link.signerId,
    );
    return {
      purpose: link.purpose,
      signerId: link.signerId,
      signatureRequestId: link.signatureRequestId,
      expiresAt: link.expiresAt,
      documentId: request?.documentId ?? null,
      documentTitle: request?.document?.filename ?? null,
      methods: request?.methods ?? [],
      order: request?.order ?? null,
      status: request?.status ?? null,
      myStatus: signer?.status ?? null,
      signerName: signer?.delegatedToName ?? signer?.name ?? null,
      requestedByName: request?.requestedByName ?? null,
      requirePasskey: request?.requirePasskey ?? false,
    };
  }

  @Public()
  @Post(':token/consent')
  async consent(
    @Param('token') token: string,
    @Body() _body: ConsentAcceptDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    const link = await this.links.resolve(token);
    if (!link.signatureRequestId) throw new BadRequestException('El enlace no tiene solicitud asociada');
    return this.signatureRequests.recordConsent(link.signatureRequestId, {
      signerId: link.signerId,
      ip,
      userAgent,
    });
  }

  @Public()
  @Post(':token/passkey/begin')
  async passkeyBegin(@Param('token') token: string) {
    const link = await this.links.resolve(token);
    if (!link.signatureRequestId) throw new BadRequestException('El enlace no tiene solicitud asociada');
    return this.passkeys.begin({ signatureRequestId: link.signatureRequestId, signerId: link.signerId });
  }

  @Public()
  @Post(':token/passkey/finish')
  async passkeyFinish(@Param('token') token: string, @Body() body: PasskeyFinishDto) {
    // Reafirma que el token sigue vivo (no consumido) antes de dejar
    // verificar una aserción sobre esa ceremonia; no lo consume — eso lo
    // hace `sign()`.
    await this.links.resolve(token);
    return this.passkeys.finish({ assertionId: body.assertionId, response: body.response as never });
  }

  @Public()
  @Post(':token/sign')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_STROKE_BYTES } }))
  async sign(
    @Param('token') token: string,
    @Body() body: SignActionDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string | undefined,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: 'image/png' })
        .addMaxSizeValidator({ maxSize: MAX_STROKE_BYTES })
        .build({ fileIsRequired: false }),
    )
    file?: Express.Multer.File,
  ) {
    const link = await this.links.resolve(token);
    if (link.purpose !== 'sign' || !link.signatureRequestId) {
      throw new BadRequestException('El enlace no sirve para firmar');
    }
    const result = await this.signatureRequests.sign(
      link.signatureRequestId,
      {
        signerId: link.signerId,
        method: body.method,
        consentAccepted: body.consentAccepted,
        biometricSessionId: body.biometricSessionId,
        passkeyAssertionId: body.passkeyAssertionId,
        ip,
        userAgent,
      },
      file?.buffer,
    );
    await this.links.consume(token);
    return result;
  }
}
