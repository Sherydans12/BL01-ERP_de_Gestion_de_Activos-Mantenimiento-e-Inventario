import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateInventoryItemDto {
  @IsString()
  @IsOptional()
  @MaxLength(60)
  inventoryCode?: string;

  @IsString()
  @MaxLength(50)
  partNumber: string;

  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUUID()
  categoryId: string;

  @IsUUID()
  unitOfMeasureId: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  brand?: string;

  /** Equipos / marcas / modelos compatibles (texto libre). */
  @IsOptional()
  @IsString()
  compatibilityInfo?: string;

  @IsBoolean()
  @IsOptional()
  isSerialized?: boolean;

  @IsBoolean()
  @IsOptional()
  isInventory?: boolean;

  @IsBoolean()
  @IsOptional()
  isAsset?: boolean;

  @IsBoolean()
  @IsOptional()
  isConsumable?: boolean;
}
