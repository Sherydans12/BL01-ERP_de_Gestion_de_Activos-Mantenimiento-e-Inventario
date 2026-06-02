import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ShiftType, OperationalStatus } from '@prisma/client';

export class CreateEquipmentAvailabilityDto {
  /** Equipo que se está reportando. */
  @IsUUID()
  equipmentId: string;

  /** Fecha del turno (ISO 8601, solo la parte de fecha se usa). */
  @IsDateString()
  reportDate: string;

  /** Turno: Día (DAY) o Noche (NIGHT). */
  @IsEnum(ShiftType)
  shift: ShiftType;

  /** Estado operativo declarado por el supervisor. */
  @IsEnum(OperationalStatus)
  status: OperationalStatus;

  /**
   * Horómetro actual del equipo al inicio del turno.
   * Opcional — si se omite no se toca el medidor.
   * Si se provee y es mayor al `currentMeter` del equipo, lo actualiza.
   * Si es menor o igual, el reporte se guarda sin modificar el medidor (no lanza error).
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  meterReading?: number;

  /** Observaciones del supervisor (máximo 500 caracteres). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comments?: string;
}
