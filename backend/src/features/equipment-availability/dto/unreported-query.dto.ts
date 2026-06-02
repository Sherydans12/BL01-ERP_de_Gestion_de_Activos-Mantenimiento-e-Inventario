import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ShiftType } from '@prisma/client';

/**
 * Query params para el endpoint de equipos no informados.
 * `date` y `shift` son obligatorios: delimitan exactamente el turno a consultar.
 */
export class UnreportedQueryDto {
  /** Fecha del turno a consultar (ISO 8601, ej: "2026-06-02"). */
  @IsDateString()
  date: string;

  /** Turno a consultar: DAY o NIGHT. */
  @IsEnum(ShiftType)
  shift: ShiftType;

  /** Filtro opcional por contrato (solo para ADMIN que ve toda la flota). */
  @IsOptional()
  @IsUUID()
  contractId?: string;
}
