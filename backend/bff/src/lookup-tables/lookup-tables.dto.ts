import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../common/pagination';
import { MAX_COLUMNS, MAX_ROWS } from './lookup-validation';

/** Solo la forma del cuerpo; la validación fina (claves, tipos, opciones, valores por columna) vive en `lookup-validation.ts`. */
export class CreateTableDto {
  @IsString() @MaxLength(60) key!: string;
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  // `@Type(() => Object)`: con enableImplicitConversion cada elemento de un `unknown[]` llegaría como Array.
  @IsArray() @ArrayMaxSize(MAX_COLUMNS) @Type(() => Object) columns!: unknown[];
}

export class UpdateTableDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_COLUMNS) @Type(() => Object) columns?: unknown[];
  @IsOptional() @IsBoolean() active?: boolean;
}

/** `?active=true|false` llega como texto: `enableImplicitConversion` convertiría 'false' en true, por eso se interpreta a mano. */
const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);

export class RowsQueryDto extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Transform(toBool) @IsBoolean() active?: boolean;
}

/** Exactamente UNA de las tres formas (se valida en el servicio): `direction`, `toTop` o `afterRowId` (null = al inicio). */
export class MoveRowDto {
  @IsOptional() @IsIn(['up', 'down']) direction?: 'up' | 'down';
  @IsOptional() @IsBoolean() toTop?: boolean;
  @IsOptional() @IsString() @MaxLength(64) afterRowId?: string | null;
}

export class CreateRowDto {
  @IsObject() values!: Record<string, unknown>;
}

export class UpdateRowDto {
  @IsOptional() @IsObject() values?: Record<string, unknown>;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ReorderDto {
  @IsArray() @ArrayMaxSize(MAX_ROWS) @IsString({ each: true }) @MaxLength(64, { each: true }) ids!: string[];
}

export class ImportRowsDto {
  @IsArray() @ArrayMaxSize(MAX_ROWS) @Type(() => Object) rows!: unknown[];
  @IsOptional() @IsBoolean() replace?: boolean;
}

export class TestQueryDto {
  @IsObject() query!: Record<string, unknown>;
  @IsOptional() @IsObject() inputs?: Record<string, unknown>;
}
