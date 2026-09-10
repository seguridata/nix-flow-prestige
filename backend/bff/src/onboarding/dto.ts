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

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  requestedBy!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  requestedByName?: string;
}

export class ActorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  actorId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  actorName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class AttachIneDto extends ActorDto {
  @IsIn(['front', 'back'])
  part!: 'front' | 'back';
}
