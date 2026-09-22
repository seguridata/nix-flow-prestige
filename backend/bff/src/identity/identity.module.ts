import { Module, type Provider } from '@nestjs/common';
import { OcrService } from './ocr.service';
import {
  HeuristicIdentityVerifier,
  IDENTITY_VERIFIER,
  RenapoIdentityVerifier,
} from './identity-verifier';
import {
  BIOMETRIC_ENGINE,
  LocalFaceBiometricEngine,
  NoopBiometricEngine,
  RemoteBiometricEngine,
} from './biometric-engine';

const identityVerifierProvider: Provider = {
  provide: IDENTITY_VERIFIER,
  useClass:
    (process.env.IDENTITY_VERIFIER ?? 'heuristic') === 'renapo'
      ? RenapoIdentityVerifier
      : HeuristicIdentityVerifier,
};

const biometricEngineProvider: Provider = {
  provide: BIOMETRIC_ENGINE,
  useClass:
    process.env.BIOMETRIC_ENGINE === 'local'
      ? LocalFaceBiometricEngine
      : process.env.BIOMETRIC_ENGINE === 'remote'
        ? RemoteBiometricEngine
        : NoopBiometricEngine,
};

/**
 * M16 — identidad: OCR/MRZ de INE + puertos `IdentityVerifier` (heuristic|renapo)
 * y `BiometricEngine` (noop|local|remote), conmutables por env.
 */
@Module({
  providers: [
    OcrService,
    HeuristicIdentityVerifier,
    RenapoIdentityVerifier,
    NoopBiometricEngine,
    RemoteBiometricEngine,
    LocalFaceBiometricEngine,
    identityVerifierProvider,
    biometricEngineProvider,
  ],
  exports: [OcrService, IDENTITY_VERIFIER, BIOMETRIC_ENGINE],
})
export class IdentityModule {}
