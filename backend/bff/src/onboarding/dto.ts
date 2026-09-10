import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
}

export class OnboardingActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class AttachIneDto {
  @IsIn(['front', 'back'])
  part!: 'front' | 'back';
}
