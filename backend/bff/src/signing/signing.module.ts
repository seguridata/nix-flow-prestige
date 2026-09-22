import { Module } from '@nestjs/common';
import { AutographSignerAdapter } from './autograph.adapter';
import { BiometricSignerAdapter } from './biometric.adapter';
import { DigitalSignerAdapter } from './digital.adapter';
import { SigningRouter } from './signing.router';
import { PdfStampService } from './pdf-stamp.service';
import { SignaturePolicyService } from './signature-policy';
import { KEY_CUSTODIAN } from './pki/key-custodian';
import { Pkcs11KeyCustodian, SoftwareKeyCustodian } from './pki/software-key-custodian';

const keyCustodianProvider = {
  provide: KEY_CUSTODIAN,
  useClass:
    (process.env.KEY_CUSTODIAN ?? 'software').toLowerCase() === 'pkcs11'
      ? Pkcs11KeyCustodian
      : SoftwareKeyCustodian,
};

@Module({
  providers: [
    keyCustodianProvider,
    SoftwareKeyCustodian,
    Pkcs11KeyCustodian,
    DigitalSignerAdapter,
    AutographSignerAdapter,
    BiometricSignerAdapter,
    SigningRouter,
    PdfStampService,
    SignaturePolicyService,
  ],
  exports: [SigningRouter, PdfStampService, BiometricSignerAdapter, SignaturePolicyService, KEY_CUSTODIAN],
})
export class SigningModule {}
