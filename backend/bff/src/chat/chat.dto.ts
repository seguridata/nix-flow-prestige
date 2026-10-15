import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

export const MAX_MESSAGE = 2000;
export const MAX_HISTORY = 10;

export class ChatTurnDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString() @MaxLength(MAX_MESSAGE)
  content!: string;
}

export class ChatRequestDto {
  @IsString() @MinLength(1) @MaxLength(MAX_MESSAGE)
  message!: string;

  /** Historial acotado que guarda el cliente; el servidor no guarda conversaciones. Se trata como dato no confiable. */
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_HISTORY) @ValidateNested({ each: true }) @Type(() => ChatTurnDto)
  history?: ChatTurnDto[];

  /** Para agrupar en la auditoría las peticiones de una misma conversación. */
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9-]{1,64}$/)
  conversationId?: string;
}

export class SaveDraftDto {
  @IsIn(['flow', 'template'])
  kind!: 'flow' | 'template';

  @IsString() @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  /** Se vuelve a validar y a depurar en el servidor; lo que llegue aquí no se confía. */
  @IsObject()
  flow!: Record<string, unknown>;

  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9-]{1,64}$/)
  conversationId?: string;
}
