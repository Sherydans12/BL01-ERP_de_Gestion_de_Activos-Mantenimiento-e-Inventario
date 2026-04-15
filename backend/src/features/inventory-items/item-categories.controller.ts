import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ItemCategoriesService } from './item-categories.service';
import type { CreateItemCategoryDto } from './item-categories.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('item-categories')
@UseGuards(JwtAuthGuard)
export class ItemCategoriesController {
  constructor(private readonly categoriesService: ItemCategoriesService) {}

  @Post()
  create(@Body() dto: CreateItemCategoryDto, @Req() req: any) {
    return this.categoriesService.create(dto, req.user);
  }

  /** Debe ir antes de `:id` */
  @Get('families')
  findFamilies(@Req() req: any) {
    return this.categoriesService.findFamilies(req.user);
  }

  @Get('children/:parentId')
  findChildren(@Param('parentId') parentId: string, @Req() req: any) {
    return this.categoriesService.findChildren(parentId, req.user);
  }

  @Get()
  findAll(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const parseNum = (s?: string) => {
      const n = s !== undefined ? Number.parseInt(s, 10) : NaN;
      return Number.isFinite(n) ? n : undefined;
    };
    const p = parseNum(page);
    const ps = parseNum(pageSize);
    if (p !== undefined || ps !== undefined) {
      return this.categoriesService.findAllPaged(req.user, {
        page: p,
        pageSize: ps,
      });
    }
    return this.categoriesService.findAll(req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: any) {
    return this.categoriesService.findOne(id, req.user);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: CreateItemCategoryDto,
    @Req() req: any,
  ) {
    return this.categoriesService.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.categoriesService.remove(id, req.user);
  }
}
