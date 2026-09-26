import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { BIOMETRIC_CONSENT_TEXT, biometricConsentHash } from './biometric-consent';
import { assertBiometricConsent } from './onboarding.service';

describe('consentimiento biométrico', () => {
  it('ata el texto vigente a un hash estable y bloquea la captura sin aceptación', () => {
    expect(BIOMETRIC_CONSENT_TEXT).toMatch(/expreso y por escrito/);
    expect(biometricConsentHash()).toHaveLength(64);
    expect(biometricConsentHash()).toBe(biometricConsentHash());
    expect(() => assertBiometricConsent({ biometricConsentAt: null })).toThrow(BadRequestException);
    expect(() => assertBiometricConsent({ biometricConsentAt: new Date() })).not.toThrow();
  });
});
