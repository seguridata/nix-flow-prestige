import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseFilePipeBuilder,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { OneTimeLinkService } from '../notifications/one-time-link.service';
import { SignatureRequestsService } from './signature-requests.service';
import { ConsentAcceptDto, SignActionDto } from './dto';

const MAX_STROKE_BYTES = 2 * 1024 * 1024;

/**
 * M13 / A-12 — portal del firmante externo. Sin sesión de Keycloak: la
 * autorización es el enlace de un solo uso (`OneTimeLink`). El token se
 * consume al aplicar la firma.
 */
@Controller('public/links')
export class PublicSignController {
  constructor(
    private readonly links: OneTimeLinkService,
    private readonly signatureRequests: SignatureRequestsService,
    private readonly prisma: PrismaService,
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
    };
  }

  @Public()
  @Post(':token/consent')
  async consent(@Param('token') token: string, @Body() body: ConsentAcceptDto) {
    const link = await this.links.resolve(token);
    if (!link.signatureRequestId) throw new BadRequestException('El enlace no tiene solicitud asociada');
    return this.signatureRequests.recordConsent(link.signatureRequestId, {
      signerId: link.signerId,
      ip: body.ip,
      userAgent: body.userAgent,
    });
  }

  @Public()
  @Post(':token/sign')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_STROKE_BYTES } }))
  async sign(
    @Param('token') token: string,
    @Body() body: SignActionDto,
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
      },
      file?.buffer,
    );
    await this.links.consume(token);
    return result;
  }
}
