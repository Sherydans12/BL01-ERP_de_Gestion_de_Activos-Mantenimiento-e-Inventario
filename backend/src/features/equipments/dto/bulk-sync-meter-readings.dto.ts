import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class BulkSyncMeterReadingItemDto {
  @IsUUID()
  equipmentId: string;

  @IsInt()
  @Min(0)
  newReading: number;

  @IsOptional()
  @IsBoolean()
  confirmedLargeJump?: boolean;
}

export class BulkSyncMeterReadingsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkSyncMeterReadingItemDto)
  items: BulkSyncMeterReadingItemDto[];
}
