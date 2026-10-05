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
import { PageQueryDto } from '../common/pagination';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { StepUp } from '../auth/step-up.decorator';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { OnboardingService } from './onboarding.service';
import { AttachIneDto, BiometricConsentDto, CreateOnboardingDto, OnboardingActionDto } from './dto';

const MAX_IMG_BYTES = 8 * 1024 * 1024; // 8 MB por imagen (INE / selfie)

const imageFile = () =>
  new ParseFilePipeBuilder()
    .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ })
    .addMaxSizeValidator({ maxSize: MAX_IMG_BYTES })
    .build({ fileIsRequired: true });

const actor = (u: AuthenticatedUser) => ({
  actorId: u.actorId,
  actorName: u.name ?? u.actorId,
  tenantId: u.tenantId,
});

/** Onboarding e identidad digital (M16). Solo RH y administración. */
@Controller('onboarding')
@Roles('rh', 'admin')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  list(@Query() page: PageQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.list(user.tenantId, page);
  }

  @Get('biometric-consent')
  biometricConsent() {
    return this.onboarding.consentNotice();
  }

  @Post()
  create(
    @Body() body: CreateOnboardingDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.onboarding.create({
      ...body,
      tenantId: user.tenantId,
      requestedBy: user.actorId,
      requestedByName: user.name,
      ip,
      userAgent,
    });
  }

  @Post(':id/biometric-consent')
  acceptBiometricConsent(
    @Param('id') id: string,
    @Body() _body: BiometricConsentDto,
    @CurrentUser() user: AuthenticatedUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.onboarding.recordBiometricConsent(id, { ...actor(user), ip, userAgent });
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.get(id, user.tenantId);
  }

  /** INE por `multipart/form-data`: `file` (imagen) + `part` (front|back). */
  @Post(':id/ine')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMG_BYTES } }))
  ine(
    @Param('id') id: string,
    @Body() body: AttachIneDto,
    @UploadedFile(imageFile()) file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onboarding.attachIne(id, {
      front: body.part === 'front' ? file.buffer : undefined,
      back: body.part === 'back' ? file.buffer : undefined,
      ...actor(user),
    });
  }

  /** Prueba de vida por `multipart/form-data`: `file` (selfie). */
  @Post(':id/liveness')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMG_BYTES } }))
  liveness(
    @Param('id') id: string,
    @UploadedFile(imageFile()) file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onboarding.captureLiveness(id, { selfie: file.buffer, ...actor(user) });
  }

  @Post(':id/actions/verify-ine')
  verify(@Param('id') id: string, @Body() body: OnboardingActionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.verifyIne(id, { ...actor(user), notes: body.notes, approve: body.approve });
  }

  @StepUp(600) // A-11 — habilitar una identidad para firmar exige re-auth reciente
  @Post(':id/actions/enable')
  enable(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.enable(id, actor(user));
  }

  @Post(':id/actions/reject')
  reject(@Param('id') id: string, @Body() body: OnboardingActionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.reject(id, { ...actor(user), notes: body.notes });
  }
}
