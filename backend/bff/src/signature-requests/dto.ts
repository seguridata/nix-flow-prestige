import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

const METHODS = ['DIGITAL', 'AUTOGRAFA', 'BIOMETRICA', 'ACCEPT', 'PASSKEY'] as const;
const ORDERS = ['SECUENCIAL', 'PARALELO'] as const;
const ROLES = ['FIRMANTE', 'REVISOR'] as const;
const KYC_POLICIES = ['NONE', 'ONCE', 'EVERY_SIGN'] as const;

const toBool = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value === 'true' || value === '1' : Boolean(value);

class SignerInputDto {
  @IsString() @MinLength(1) @MaxLength(200)
  signerId!: string;

  @IsOptional() @IsString() @MaxLength(160)
  name?: string;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsIn(ROLES)
  role?: (typeof ROLES)[number];
}

export class CreateSignatureRequestDto {
  @IsString() @MinLength(1) @MaxLength(200)
  documentId!: string;

  @IsOptional() @IsString() @MaxLength(200)
  templateId?: string;

  /** Requerido salvo que `templateId` traiga sus propios `allowedMethods`. */
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsIn(METHODS, { each: true })
  methods?: (typeof METHODS)[number][];

  @IsOptional() @IsIn(ORDERS)
  order?: (typeof ORDERS)[number];

  @IsOptional() @IsInt() @Min(1) @Max(2160)
  slaHours?: number;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SignerInputDto)
  signers!: SignerInputDto[];

  @IsOptional() @Transform(toBool) @IsBoolean()
  requirePasskey?: boolean;

  @IsOptional() @IsIn(KYC_POLICIES)
  kycPolicy?: (typeof KYC_POLICIES)[number];
}

/** Cuerpo de `POST /signature-requests/:id/actions/sign` (multipart o JSON). El firmante sale del token. */
export class SignActionDto {
  @IsIn(METHODS)
  method!: (typeof METHODS)[number];

  @IsOptional() @IsString() @MaxLength(200)
  biometricSessionId?: string;

  @IsOptional() @IsString() @MaxLength(200)
  passkeyAssertionId?: string;

  @IsOptional() @Transform(toBool) @IsBoolean()
  consentAccepted?: boolean;
}

export class PasskeyFinishDto {
  @IsString() @MinLength(1) @MaxLength(200)
  assertionId!: string;

  // La respuesta WebAuthn del navegador no tiene una forma fija que valga la
  // pena describir campo a campo con class-validator: se valida
  // criptográficamente dentro de `PasskeyCeremonyService.finish`, no aquí.
  @IsObject()
  response!: Record<string, unknown>;
}

/**
 * Cuerpo vacío: la IP y el user-agent de la prueba de consentimiento se toman
 * de la conexión en el controller, NUNCA del cliente (serían falsificables).
 */
export class ConsentAcceptDto {}

export class RejectDto {
  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

export class DelegateDto {
  @IsString() @MinLength(1) @Matches(/^[A-Za-z0-9._@+-]{1,120}$/, { message: 'toSignerId inválido' })
  toSignerId!: string;

  @IsOptional() @IsString() @MaxLength(160)
  toName?: string;
}

export class ListSignatureRequestsQueryDto {
  @IsOptional() @IsString() @MaxLength(200) signerId?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsString() @MaxLength(200) documentId?: string;
  @IsOptional() @IsString() @MaxLength(200) requestedBy?: string;
}

/** Sprint 5 — plantilla de envelope: defaults reutilizables de order/kycPolicy/métodos. */
export class EnvelopeTemplateDto {
  @IsString() @MinLength(1) @MaxLength(160)
  name!: string;

  @IsOptional() @IsIn(ORDERS)
  order?: (typeof ORDERS)[number];

  @IsOptional() @IsIn(KYC_POLICIES)
  kycPolicy?: (typeof KYC_POLICIES)[number];

  @IsArray() @ArrayMinSize(1) @IsIn(METHODS, { each: true })
  allowedMethods!: (typeof METHODS)[number][];

  @IsOptional() @Transform(toBool) @IsBoolean()
  requirePasskey?: boolean;

  @IsOptional() @IsInt() @Min(1) @Max(2160)
  slaHours?: number;
}
