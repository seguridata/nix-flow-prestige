import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const METHODS = ['DIGITAL', 'AUTOGRAFA', 'BIOMETRICA'] as const;

const toBool = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value === 'true' || value === '1' : Boolean(value);

/** Cuerpo de `POST /signature-requests/:id/actions/sign` (multipart o JSON). */
export class SignActionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  signerId!: string;

  @IsIn(METHODS)
  method!: (typeof METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  biometricSessionId?: string;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  consentAccepted?: boolean;
}
