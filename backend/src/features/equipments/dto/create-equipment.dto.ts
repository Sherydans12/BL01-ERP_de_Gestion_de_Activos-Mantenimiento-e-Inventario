import {
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  IsDateString,
  IsUUID,
} from 'class-validator';
import { MeterType } from '@prisma/client';

export class CreateEquipmentDto {
  @IsUUID()
  contractId: string;

  @IsUUID()
  @IsOptional()
  subcontractId?: string;

  @IsString()
  @IsOptional()
  mineInternalId?: string;

  @IsString()
  internalId: string;

  @IsString()
  @IsOptional()
  plate?: string;

  @IsString()
  type: string;

  @IsString()
  brand: string;

  @IsString()
  model: string;

  @IsEnum(MeterType)
  meterType: MeterType;

  @IsInt()
  @IsOptional()
  initialMeter?: number;

  @IsInt()
  @IsOptional()
  currentMeter?: number;

  @IsString()
  @IsOptional()
  vin?: string;

  @IsString()
  @IsOptional()
  engineNumber?: string;

  @IsInt()
  @IsOptional()
  year?: number;

  @IsString()
  @IsOptional()
  fuelType?: string;

  @IsString()
  @IsOptional()
  driveType?: string;

  @IsString()
  @IsOptional()
  ownership?: string;

  @IsInt()
  @IsOptional()
  maintenanceFrequency?: number;

  @IsDateString()
  @IsOptional()
  lastMaintenanceDate?: string;

  @IsInt()
  @IsOptional()
  lastMaintenanceMeter?: number;

  @IsString()
  @IsOptional()
  lastMaintenanceType?: string;

  @IsDateString()
  @IsOptional()
  techReviewExp?: string;

  @IsDateString()
  @IsOptional()
  circPermitExp?: string;

  @IsDateString()
  @IsOptional()
  soapExp?: string;

  @IsDateString()
  @IsOptional()
  mechanicalCertExp?: string;

  @IsDateString()
  @IsOptional()
  liabilityPolicyExp?: string;
}
