import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PageQueryDto } from '../common/pagination';

export class CreateDocumentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  caseId!: string;

  /** Opcional: si no viene, se usa el nombre original del archivo subido. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;
}

export class ListDocumentsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  caseId?: string;
}
