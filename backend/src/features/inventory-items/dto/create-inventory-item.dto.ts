import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUUID,
  MaxLength,
  IsNumber,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateInventoryItemDto {
  /** Ignorado en POST: el servicio asigna IN####; si el cliente lo envía no vacío → 400. */
  @IsString()
  @IsOptional()
  @MaxLength(60)
  inventoryCode?: string;

  /** Número de parte — opcional (repuestos sí; insumos sin referencia, no). */
  @IsString()
  @IsOptional()
  @MaxLength(50)
  partNumber?: string;

  /** Proveedor habitual del artículo (catálogo inventory_suppliers). */
  @IsUUID()
  @IsOptional()
  supplierId?: string;

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

  /** Si se informa, el servicio crea `item_stocks` en esa bodega (cantidad 0) con min/max obligatorios. */
  @IsUUID()
  @IsOptional()
  warehouseId?: string;

  @ValidateIf((o) => !!o.warehouseId?.trim())
  @IsNumber()
  @Min(0)
  minStock?: number;

  @ValidateIf((o) => !!o.warehouseId?.trim())
  @IsNumber()
  @Min(0)
  maxStock?: number;
}
