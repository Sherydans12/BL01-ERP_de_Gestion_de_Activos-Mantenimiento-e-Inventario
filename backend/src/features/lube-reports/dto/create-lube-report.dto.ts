import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class LubeReportLineDto {
  @IsUUID()
  itemId: string;

  /** Cantidad despachada. Mínimo 0.001 para soportar fracciones (LT, KG). */
  @IsNumber()
  @Min(0.001)
  quantity: number;
}

export class CreateLubeReportDto {
  /** Contrato/faena bajo el que se registra el despacho. */
  @IsUUID()
  contractId: string;

  /** Equipo que recibe el lubricante. */
  @IsUUID()
  equipmentId: string;

  /** Bodega origen del despacho (física o virtual/camión lubricador). */
  @IsUUID()
  warehouseId: string;

  /** Fecha del despacho (ISO 8601). */
  @IsDateString()
  dispatchDate: string;

  /**
   * Horómetro/cuentakilómetros del equipo al momento del despacho.
   * Opcional: si se omite no se actualiza el medidor.
   * Si se provee, debe ser ≥ al `currentMeter` del equipo.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  meterReading?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LubeReportLineDto)
  lines: LubeReportLineDto[];
}
