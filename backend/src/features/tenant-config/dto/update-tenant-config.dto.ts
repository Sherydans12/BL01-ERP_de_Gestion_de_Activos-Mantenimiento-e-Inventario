import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  Matches,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BackgroundPreference } from '@prisma/client';

export class UpdateTenantConfigDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  rut?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  logoUrl?: string;

  @IsString()
  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/i, {
    message: 'El color primario debe ser un código hex válido, ej. #FF3366',
  })
  primaryColor?: string;

  @IsEnum(BackgroundPreference)
  @IsOptional()
  backgroundPreference?: BackgroundPreference;

  @IsObject()
  @IsOptional()
  sidebarPermissions?: Record<string, string[]>;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  laborRatePerHour?: number;
}
