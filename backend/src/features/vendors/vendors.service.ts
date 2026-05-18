import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VENDOR_LIST_SEARCH_MAX_LEN = 120;
const VENDOR_LIST_PAGE_SIZE_MAX = 100;

const VENDOR_LIST_SORT_FIELDS = [
  'name',
  'code',
  'createdAt',
  'updatedAt',
  'rut',
  'isActive',
] as const;

type VendorListSortField = (typeof VENDOR_LIST_SORT_FIELDS)[number];

function isVendorListSortField(v: string): v is VendorListSortField {
  return (VENDOR_LIST_SORT_FIELDS as readonly string[]).includes(v);
}

function parseVendorListSort(
  sort?: string,
  dir?: string,
): { field: VendorListSortField; order: 'asc' | 'desc' } {
  const field: VendorListSortField =
    sort && isVendorListSortField(sort) ? sort : 'name';
  if (dir === 'asc' || dir === 'desc') {
    return { field, order: dir };
  }
  if (field === 'createdAt' || field === 'updatedAt' || field === 'isActive') {
    return { field, order: 'desc' };
  }
  return { field, order: 'asc' };
}

function isUuid(value: string | undefined | null): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  private vendorListSearchOr(term: string): Prisma.VendorWhereInput[] {
    const mode = 'insensitive' as const;
    const contains = (s: string): Prisma.StringFilter => ({
      contains: s,
      mode,
    });
    const clauses: Prisma.VendorWhereInput[] = [
      { code: contains(term) },
      { name: contains(term) },
      { rut: contains(term) },
      { contactName: contains(term) },
      { contactEmail: contains(term) },
      { contactPhone: contains(term) },
      { address: contains(term) },
      { businessActivity: contains(term) },
      { fax: contains(term) },
      { city: contains(term) },
    ];
    if (isUuid(term)) {
      clauses.unshift({ id: term });
    }
    return clauses;
  }

  private buildVendorListWhere(
    tenantId: string,
    filters: {
      search?: string;
      includeInactive: boolean;
    },
  ): Prisma.VendorWhereInput {
    const searchTerm =
      typeof filters.search === 'string'
        ? filters.search.trim().slice(0, VENDOR_LIST_SEARCH_MAX_LEN)
        : '';
    const searchOr = searchTerm ? this.vendorListSearchOr(searchTerm) : [];
    return {
      tenantId,
      ...(!filters.includeInactive ? { isActive: true } : {}),
      ...(searchOr.length > 0 ? { OR: searchOr } : {}),
    };
  }

  async findAll(
    tenantId: string,
    opts: {
      search?: string;
      includeInactive?: boolean;
      page?: number;
      pageSize?: number;
      sort?: string;
      dir?: string;
    },
  ) {
    const pageSize = Math.min(
      VENDOR_LIST_PAGE_SIZE_MAX,
      Math.max(1, Math.floor(opts.pageSize ?? 25)),
    );
    const requestedPage = Math.max(1, Math.floor(opts.page ?? 1));
    const { field: sortField, order: sortOrder } = parseVendorListSort(
      opts.sort,
      opts.dir,
    );

    const where = this.buildVendorListWhere(tenantId, {
      search: opts.search,
      includeInactive: opts.includeInactive === true,
    });

    const total = await this.prisma.vendor.count({ where });
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, maxPage);
    const skip = (page - 1) * pageSize;

    const orderBy = {
      [sortField]: sortOrder,
    } as Prisma.VendorOrderByWithRelationInput;

    const data = await this.prisma.vendor.findMany({
      where,
      orderBy,
      skip,
      take: pageSize,
    });

    return { data, total, page, pageSize };
  }

  async findById(id: string, tenantId: string) {
    const vendor = await this.prisma.vendor.findFirst({
      where: { id, tenantId },
    });
    if (!vendor) throw new NotFoundException('Proveedor no encontrado');
    return vendor;
  }

  async create(
    data: {
      code: string;
      name: string;
      rut?: string;
      contactName?: string;
      contactEmail?: string;
      contactPhone?: string;
      address?: string;
      businessActivity?: string;
      fax?: string;
      city?: string;
    },
    tenantId: string,
  ) {
    try {
      return await this.prisma.vendor.create({
        data: { ...data, tenantId },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe un proveedor con ese código o RUT',
        );
      }
      throw e;
    }
  }

  async update(
    id: string,
    data: {
      name?: string;
      rut?: string;
      contactName?: string;
      contactEmail?: string;
      contactPhone?: string;
      address?: string;
      businessActivity?: string;
      fax?: string;
      city?: string;
      isActive?: boolean;
    },
    tenantId: string,
  ) {
    await this.findById(id, tenantId);
    try {
      return await this.prisma.vendor.update({
        where: { id },
        data,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe un proveedor con ese RUT');
      }
      throw e;
    }
  }

  async remove(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.prisma.vendor.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
