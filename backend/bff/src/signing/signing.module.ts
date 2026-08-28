import { Module } from '@nestjs/common';
import { AutographSignerAdapter } from './autograph.adapter';
import { BiometricSignerAdapter } from './biometric.adapter';
import { DigitalSignerAdapter } from './digital.adapter';
import { SigningRouter } from './signing.router';
import { PdfStampService } from './pdf-stamp.service';

@Module({
  providers: [
    DigitalSignerAdapter,
    AutographSignerAdapter,
    BiometricSignerAdapter,
    SigningRouter,
    PdfStampService,
  ],
  exports: [SigningRouter, PdfStampService, BiometricSignerAdapter],
})
export class SigningModule {}
