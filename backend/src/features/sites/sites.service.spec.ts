import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '../../prisma/prisma.service';
import { SitesService } from './sites.service';

describe('SitesService', () => {
  let service: SitesService;
  let prisma: DeepMockProxy<PrismaService>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [SitesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(SitesService);
  });

  it('debe instanciarse', () => {
    expect(service).toBeDefined();
  });
});
