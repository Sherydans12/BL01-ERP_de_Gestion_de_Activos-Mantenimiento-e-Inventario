import { IsString, IsNotEmpty, IsOptional, Matches, MaxLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty({ message: 'El código es requerido.' })
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: 'El código solo puede contener letras, números, guiones o guiones bajos.' })
  @MaxLength(20, { message: 'El código no puede exceder los 20 caracteres.' })
  code: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre es requerido.' })
  @MaxLength(100, { message: 'El nombre no puede exceder los 100 caracteres.' })
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(50, { message: 'El color principal no puede exceder los 50 caracteres.' })
  primaryColor?: string;
}
