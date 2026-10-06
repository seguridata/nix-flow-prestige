import { Equals, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const KINDS = ['EMPLEADO', 'PROVEEDOR', 'CLIENTE'] as const;

export class CreateOnboardingDto {
  @IsOptional()
  @IsIn(KINDS)
  kind?: (typeof KINDS)[number];

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(18)
  curp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(13)
  rfc?: string;

  /** El titular aceptó el texto de datos sensibles. La casilla no puede ir marcada por defecto. */
  @IsBoolean()
  @Equals(true, {
    message: 'Se requiere el consentimiento expreso y por escrito del titular para tratar datos biométricos (LFPDPPP).',
  })
  biometricConsent!: boolean;
}

export class BiometricConsentDto {
  @IsBoolean()
  @Equals(true, {
    message: 'Se requiere el consentimiento expreso y por escrito del titular para tratar datos biométricos (LFPDPPP).',
  })
  biometricConsent!: boolean;
}

export class OnboardingActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** M16 — RH puede rechazar explícitamente la verificación de la INE. */
  @IsOptional()
  @IsBoolean()
  approve?: boolean;
}

export class EnableOnboardingDto {
  /** Anular un resultado biométrico NO aprobado. Exige `notes` (≥ 10 caracteres) y queda auditado. */
  @IsOptional()
  @IsBoolean()
  override?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class AttachIneDto {
  @IsIn(['front', 'back'])
  part!: 'front' | 'back';
}
