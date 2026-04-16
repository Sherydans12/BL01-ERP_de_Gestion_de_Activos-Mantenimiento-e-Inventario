import { Type } from 'class-transformer';
import {
  IsArray,
  ArrayMinSize,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class LineAwardDto {
  @IsUUID()
  requisitionItemId: string;

  @IsUUID()
  quotationItemId: string;
}

export class SaveLineAwardsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LineAwardDto)
  awards: LineAwardDto[];
}
