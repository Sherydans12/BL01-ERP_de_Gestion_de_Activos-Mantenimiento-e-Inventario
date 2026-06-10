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

export class BatchAvailabilityRowDto {
  @IsUUID()
  equipmentId: string;

  @IsEnum(OperationalStatus)
  status: OperationalStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  meterReading?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comments?: string;
}

/** Body POST /equipment-availability/batch — creación masiva con éxito parcial. */
export class BatchCreateAvailabilityDto {
  @IsDateString()
  reportDate: string;

  /**
   * Turno del lote: DAY o NIGHT.
   * Opcional — `resolveShift()` aplica DAY si se omite.
   * Si `hasNightShift=false` y llega NIGHT, el servicio normaliza a DAY (sin 400).
   */
  @IsOptional()
  @IsEnum(ShiftType)
  shift?: ShiftType;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchAvailabilityRowDto)
  rows: BatchAvailabilityRowDto[];
}
