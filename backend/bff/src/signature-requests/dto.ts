import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

const METHODS = ['DIGITAL', 'AUTOGRAFA', 'BIOMETRICA'] as const;
const ORDERS = ['SECUENCIAL', 'PARALELO'] as const;
const ROLES = ['FIRMANTE', 'REVISOR'] as const;

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

  @IsArray() @ArrayMinSize(1) @IsIn(METHODS, { each: true })
  methods!: (typeof METHODS)[number][];

  @IsOptional() @IsIn(ORDERS)
  order?: (typeof ORDERS)[number];

  @IsOptional() @IsInt() @Min(1) @Max(2160)
  slaHours?: number;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SignerInputDto)
  signers!: SignerInputDto[];
}

/** Cuerpo de `POST /signature-requests/:id/actions/sign` (multipart o JSON). El firmante sale del token. */
export class SignActionDto {
  @IsIn(METHODS)
  method!: (typeof METHODS)[number];

  @IsOptional() @IsString() @MaxLength(200)
  biometricSessionId?: string;

  @IsOptional() @Transform(toBool) @IsBoolean()
  consentAccepted?: boolean;
}

export class ConsentAcceptDto {
  @IsOptional() @IsString() @MaxLength(64)
  ip?: string;

  @IsOptional() @IsString() @MaxLength(512)
  userAgent?: string;
}

export class RejectDto {
  @IsOptional() @IsString() @MaxLength(2000)
  reason?: string;
}

export class DelegateDto {
  @IsString() @MinLength(1) @MaxLength(200)
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
