import { IsString, MaxLength, MinLength } from 'class-validator';

/** Reset administrativo: solo nueva contraseña (sin contraseña actual). */
export class AdminSetPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}
