import {
  Body,
  Controller,
  Get,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '../auth/public.decorator';
import { SignatureRequestsService, type SignatureMethod, type SignerRole, type SigningOrder } from './signature-requests.service';
import { SignActionDto } from './dto';

const MAX_STROKE_BYTES = 2 * 1024 * 1024; // 2 MB — un PNG de trazo es de ~10–100 KB

@Controller('signature-requests')
export class SignatureRequestsController {
  constructor(private readonly signatureRequests: SignatureRequestsService) {}

  @Public()
  @Post()
  create(
    @Body()
    body: {
      documentId: string;
      methods: SignatureMethod[];
      order?: SigningOrder;
      requestedBy?: string;
      requestedByName?: string;
      signers: { signerId: string; name?: string; email?: string; role?: SignerRole }[];
    },
  ) {
    return this.signatureRequests.create(body);
  }

  @Public()
  @Get()
  list(
    @Query('signerId') signerId?: string,
    @Query('status') status?: string,
    @Query('documentId') documentId?: string,
    @Query('requestedBy') requestedBy?: string,
  ) {
    return this.signatureRequests.list(signerId, status, documentId, requestedBy);
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

  @Public()
  @Get(':id/status')
  status(@Param('id') id: string) {
    return this.signatureRequests.getOrThrow(id);
  }

  @Public()
  @Post(':id/actions/consent')
  consentAccept(
    @Param('id') id: string,
    @Body() body: { signerId: string; ip?: string; userAgent?: string },
  ) {
    return this.signatureRequests.recordConsent(id, body);
  }

  /**
   * Firma. `multipart/form-data` cuando el método es AUTÓGRAFA (campo `file`
   * con el PNG del trazo); JSON en los demás casos. El trazo nunca viaja ni
   * se persiste como base64.
   */
  @Public()
  @Post(':id/actions/sign')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_STROKE_BYTES } }))
  sign(
    @Param('id') id: string,
    @Body() body: SignActionDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: 'image/png' })
        .addMaxSizeValidator({ maxSize: MAX_STROKE_BYTES })
        .build({ fileIsRequired: false }),
    )
    file?: Express.Multer.File,
  ) {
    return this.signatureRequests.sign(id, body, file?.buffer);
  }

  @Public()
  @Post(':id/actions/reject')
  reject(@Param('id') id: string, @Body() body: { signerId: string; reason?: string }) {
    return this.signatureRequests.reject(id, body);
  }

  @Public()
  @Post(':id/actions/cancel')
  cancel(@Param('id') id: string, @Body() body: { actorId?: string } = {}) {
    return this.signatureRequests.cancel(id, body);
  }

  @Public()
  @Post(':id/actions/delegate')
  delegate(
    @Param('id') id: string,
    @Body() body: { fromSignerId: string; toSignerId: string; toName?: string },
  ) {
    return this.signatureRequests.delegate(id, body);
  }
}
