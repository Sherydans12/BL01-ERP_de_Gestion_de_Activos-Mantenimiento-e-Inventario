import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';
import { AffectedSystem, FaultCriticality } from '@prisma/client';

export class CreateFaultReportDto {
  @IsUUID()
  equipmentId: string;

  /** Fecha/hora del evento de falla (ISO 8601). */
  @IsDateString()
  eventDate: string;

  /** Horómetro capturado al momento de la falla. Solo avanza si es > currentMeter. */
  @IsOptional()
  @IsInt()
  @Min(1)
  meterAtFault?: number;

  @IsEnum(AffectedSystem)
  affectedSystem: AffectedSystem;

  @IsEnum(FaultCriticality)
  criticality: FaultCriticality;

  /** Descripción del síntoma observado en terreno. */
  @IsString()
  @MinLength(10, {
    message: 'La descripción del síntoma debe tener al menos 10 caracteres.',
  })
  symptomDescription: string;
}
