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

  /** Turno a exportar: DAY o NIGHT. */
  @IsEnum(ShiftType)
  shift: ShiftType;

  /**
   * Filtro opcional por contrato.
   * Solo aplica para ADMIN que ve toda la flota del tenant.
   */
  @IsOptional()
  @IsUUID()
  contractId?: string;
}
