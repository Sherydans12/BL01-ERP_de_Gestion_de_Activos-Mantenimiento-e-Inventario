import {
  IsDateString,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ShiftType } from '@prisma/client';

export type ShiftBoardTab = 'ALL' | 'REPORTED' | 'PENDING' | 'EXCLUDED';

/**
 * Query params para el tablero del turno (Monitor de Flota).
 */
export class ShiftBoardQueryDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsEnum(ShiftType)
  shift?: ShiftType;

  @IsOptional()
  @IsUUID()
  contractId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['ALL', 'REPORTED', 'PENDING', 'EXCLUDED'])
  tab?: ShiftBoardTab;

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
