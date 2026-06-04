import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ShiftType } from '@prisma/client';

/**
 * Query params para el endpoint de equipos no informados.
 */
export class UnreportedQueryDto {
  /** Fecha del turno a consultar (ISO 8601, ej: "2026-06-02"). */
  @IsDateString()
  date: string;

  /**
   * Turno a consultar: DAY o NIGHT.
   * Opcional — si se omite el servicio aplica DAY como default.
   * Si se envía NIGHT y el tenant tiene hasNightShift=false, se rechaza con 400.
   */
  @IsOptional()
  @IsEnum(ShiftType)
  shift?: ShiftType;

  /** Filtro opcional por contrato (solo para ADMIN que ve toda la flota). */
  @IsOptional()
  @IsUUID()
  contractId?: string;

  /** Búsqueda por código interno, patente, marca o modelo. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
