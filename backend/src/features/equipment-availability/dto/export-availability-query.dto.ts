import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ShiftType } from '@prisma/client';

/**
 * Query params para el endpoint de exportación de plantilla Excel.
 * Determina el contexto del turno y el alcance de la flota a incluir.
 */
export class ExportAvailabilityQueryDto {
  /** Fecha del turno (ISO 8601, ej: "2026-06-03"). */
  @IsDateString()
  reportDate: string;

  /**
   * Turno a exportar: DAY o NIGHT.
   * Opcional — si se omite el servicio aplica DAY como default.
   * Si se envía NIGHT y el tenant tiene hasNightShift=false, se rechaza con 400.
   */
  @IsOptional()
  @IsEnum(ShiftType)
  shift?: ShiftType;

  /**
   * Filtro opcional por contrato.
   * Solo aplica para ADMIN que ve toda la flota del tenant.
   */
  @IsOptional()
  @IsUUID()
  contractId?: string;
}
