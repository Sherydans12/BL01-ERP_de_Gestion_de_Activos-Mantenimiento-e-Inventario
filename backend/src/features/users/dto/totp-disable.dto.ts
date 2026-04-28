import { IsString, Length, Matches, MinLength } from 'class-validator';

export class TotpDisableDto {
  @IsString()
  @MinLength(1)
  password!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  totpCode!: string;
}
