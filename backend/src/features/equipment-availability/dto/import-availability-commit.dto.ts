import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OperationalStatus, ShiftType } from '@prisma/client';

/** Una fila del lote de importación, ya validada por el cliente. */
export class ImportRowCommitDto {
  /** UUID del equipo (columna oculta _eq_id de la plantilla). */
  @IsUUID()
  equipmentId: string;

  /** Estado operativo declarado. */
  @IsEnum(OperationalStatus)
  status: OperationalStatus;

  /** Horómetro en horas. Opcional; si <= currentMeter del equipo, se ignora silenciosamente. */
  @IsOptional()
  @IsInt()
  @Min(1)
  meterReading?: number;

  /** Observaciones del supervisor. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comments?: string;
}

/** Body del endpoint POST /import/commit — lote limpio de filas a persistir. */
export class ImportAvailabilityCommitDto {
  /** Fecha del turno (ISO 8601). */
  @IsDateString()
  reportDate: string;

  /**
   * Turno: DAY o NIGHT.
   * Opcional — `resolveShift()` aplica DAY si se omite.
   * Si `hasNightShift=false` y llega NIGHT, el servicio normaliza a DAY (sin 400).
   */
  @IsOptional()
  @IsEnum(ShiftType)
  shift?: ShiftType;

  /**
   * Filas a persistir.
   * El frontend envía solo las filas con action !== 'ERROR' y !== 'SKIP'.
   */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRowCommitDto)
  rows: ImportRowCommitDto[];
}
