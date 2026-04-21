import { PartialType } from '@nestjs/mapped-types';
import { CreateInventoryItemDto } from './create-inventory-item.dto';

/** PUT de artículo: el cliente envía el formulario completo; campos opcionales vía PartialType. */
export class UpdateInventoryItemDto extends PartialType(
  CreateInventoryItemDto,
) {}
