import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  Matches,
  IsNumber,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BackgroundPreference } from '@prisma/client';

export class UpdateTenantConfigDto {
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
  @MaxLength(120)
  city?: string;

  /** Razón social para emitir factura / PDF OC (ej. «TPM Minería SpA»). */
  @IsString()
  @IsOptional()
  @MaxLength(200)
  invoiceLegalName?: string;

  /** Aviso legal del recuadro superior del PDF de OC (saltos de línea = párrafos). Vacío = texto por defecto del sistema. */
  @IsString()
  @IsOptional()
  @MaxLength(4000)
  ocPdfLegalNotice?: string;

  @IsString()
  @IsOptional()
  logoUrl?: string;

  /** Clave storage del logo solo para PDFs de compras; vacío → quitar (PATCH). */
  @IsString()
  @IsOptional()
  pdfLogoUrl?: string | null;

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
