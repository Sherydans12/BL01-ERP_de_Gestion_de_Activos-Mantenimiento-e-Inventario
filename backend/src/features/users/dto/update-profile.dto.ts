import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  /** Si true, elimina avatar en storage y en BD. */
  @IsOptional()
  @IsBoolean()
  removeAvatar?: boolean;

  /** Recibir correo si el inicio de sesión difiere en IP o país respecto al anterior. */
  @IsOptional()
  @IsBoolean()
  notifyUnusualLogin?: boolean;
}
