import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '../auth/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { StepUp } from '../auth/step-up.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { SignatureRequestsService } from './signature-requests.service';
import {
  ConsentAcceptDto,
  CreateSignatureRequestDto,
  DelegateDto,
  ListSignatureRequestsQueryDto,
  RejectDto,
  SignActionDto,
} from './dto';

const MAX_STROKE_BYTES = 2 * 1024 * 1024; // 2 MB — un PNG de trazo es de ~10–100 KB

@Controller('signature-requests')
export class SignatureRequestsController {
  constructor(private readonly signatureRequests: SignatureRequestsService) {}

  @Roles('sender', 'admin')
  @Post()
  create(@Body() body: CreateSignatureRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.signatureRequests.create({
      ...body,
      requestedBy: user.actorId,
      requestedByName: user.name,
      tenantId: user.tenantId,
    });
  }

  @Get()
  list(@Query() query: ListSignatureRequestsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    // A-07 — quien no es emisor/admin/auditor sólo ve las solicitudes en las que
    // es firmante (o su delegado); nunca las de todo el tenant.
    const privileged = ['sender', 'admin', 'auditor'].some((r) => user.roles.includes(r));
    const signerId = privileged ? query.signerId : user.actorId;
    const requestedBy = privileged ? query.requestedBy : undefined;
    return this.signatureRequests.list(
      signerId,
      query.status,
      query.documentId,
      requestedBy,
      user.tenantId,
    );
  }

  @Public()
  @Get('consent')
  consent() {
    return this.signatureRequests.consentText();
  }

  @Public()
  @Get('capabilities')
  capabilities() {
    return this.signatureRequests.capabilities();
  }

  /** M10 — política de firma efectiva para el tenant del usuario. */
  @Get('policy')
  policy(@CurrentUser() user: AuthenticatedUser) {
    return this.signatureRequests.signaturePolicy(user.tenantId);
  }

  @Get(':id/status')
  status(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.signatureRequests.getOrThrow(id, user.tenantId);
  }

  @Post(':id/actions/consent')
  consentAccept(
    @Param('id') id: string,
    @Body() _body: ConsentAcceptDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.signatureRequests.recordConsent(id, { signerId: user.actorId, ip, userAgent });
  }

  /**
   * Firma. `multipart/form-data` cuando el método es AUTÓGRAFA (campo `file`
   * con el PNG del trazo); JSON en los demás casos. El firmante sale del token;
   * el trazo nunca viaja ni se persiste como base64.
   */
  @StepUp(300) // A-11 — la firma exige autenticación de los últimos 5 min
  @Post(':id/actions/sign')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_STROKE_BYTES } }))
  sign(
    @Param('id') id: string,
    @Body() body: SignActionDto,
    @CurrentUser() user: AuthenticatedUser,
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
    return this.signatureRequests.sign(
      id,
      { ...body, signerId: user.actorId, ip, userAgent },
      file?.buffer,
    );
  }

  @Post(':id/actions/reject')
  reject(@Param('id') id: string, @Body() body: RejectDto, @CurrentUser() user: AuthenticatedUser) {
    return this.signatureRequests.reject(id, { signerId: user.actorId, reason: body.reason });
  }

  @Roles('sender', 'admin')
  @Post(':id/actions/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.signatureRequests.cancel(id, { actorId: user.actorId });
  }

  @Post(':id/actions/delegate')
  delegate(@Param('id') id: string, @Body() body: DelegateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.signatureRequests.delegate(id, { fromSignerId: user.actorId, ...body });
  }
}
