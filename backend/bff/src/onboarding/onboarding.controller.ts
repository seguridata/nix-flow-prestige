import {
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
import { OnboardingService } from './onboarding.service';
import { ActorDto, AttachIneDto, CreateOnboardingDto } from './dto';

const MAX_IMG_BYTES = 8 * 1024 * 1024; // 8 MB por imagen (INE / selfie)

const imageFile = () =>
  new ParseFilePipeBuilder()
    .addFileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ })
    .addMaxSizeValidator({ maxSize: MAX_IMG_BYTES })
    .build({ fileIsRequired: true });

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Public()
  @Get()
  list() {
    return this.onboarding.list();
  }

  @Public()
  @Post()
  create(@Body() body: CreateOnboardingDto) {
    return this.onboarding.create(body);
  }

  @Public()
  @Get(':id')
  get(@Param('id') id: string) {
    return this.onboarding.get(id);
  }

  /** INE por `multipart/form-data`: `file` (imagen) + `part` (front|back) + actor. */
  @Public()
  @Post(':id/ine')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMG_BYTES } }))
  ine(
    @Param('id') id: string,
    @Body() body: AttachIneDto,
    @UploadedFile(imageFile()) file: Express.Multer.File,
  ) {
    return this.onboarding.attachIne(id, {
      front: body.part === 'front' ? file.buffer : undefined,
      back: body.part === 'back' ? file.buffer : undefined,
      actorId: body.actorId,
      actorName: body.actorName,
    });
  }

  /** Prueba de vida por `multipart/form-data`: `file` (selfie) + actor. */
  @Public()
  @Post(':id/liveness')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMG_BYTES } }))
  liveness(
    @Param('id') id: string,
    @Body() body: ActorDto,
    @UploadedFile(imageFile()) file: Express.Multer.File,
  ) {
    return this.onboarding.captureLiveness(id, {
      selfie: file.buffer,
      actorId: body.actorId,
      actorName: body.actorName,
    });
  }

  @Public()
  @Post(':id/actions/verify-ine')
  verify(@Param('id') id: string, @Body() body: ActorDto) {
    return this.onboarding.verifyIne(id, body);
  }

  @Public()
  @Post(':id/actions/enable')
  enable(@Param('id') id: string, @Body() body: ActorDto) {
    return this.onboarding.enable(id, body);
  }

  @Public()
  @Post(':id/actions/reject')
  reject(@Param('id') id: string, @Body() body: ActorDto) {
    return this.onboarding.reject(id, body);
  }
}
