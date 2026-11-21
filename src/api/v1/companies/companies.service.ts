import prisma from '../../../config/db';
import { AppError } from '../../../middlewares/error.handler';

interface CreateCompanyInput {
  name: string;
  document?: string;
  timezone?: string;
  isActive?: boolean;
}

interface UpdateCompanyInput {
  name?: string;
  document?: string | null;
  timezone?: string;
  isActive?: boolean;
}

/**
 * Gestão de Companies é operação de plataforma: não há companyId em Company
 * (D-0B.6). Qualquer usuário com companies.* pode listar/criar/atualizar;
 * o isolamento de dados continua vigente em todos os modelos tenant-scoped.
 */
export class CompaniesService {
  async list(page: number, limit: number) {
    const [items, total] = await Promise.all([
      prisma.company.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.company.count(),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async getById(id: string) {
    const company = await prisma.company.findUnique({ where: { id } });
    if (!company) {
      throw new AppError('Empresa não encontrada', 404);
    }
    return company;
  }

  async create(input: CreateCompanyInput) {
    const name = input.name.trim();
    await this.assertNameAvailable(name);

    return prisma.company.create({
      data: {
        name,
        document: input.document?.trim() || null,
        timezone: input.timezone?.trim() || 'America/Sao_Paulo',
        isActive: input.isActive ?? true,
      },
    });
  }

  async update(id: string, input: UpdateCompanyInput) {
    await this.getById(id);

    if (input.name !== undefined) {
      const name = input.name.trim();
      await this.assertNameAvailable(name, id);
      input.name = name;
    }

    return prisma.company.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.document !== undefined
          ? { document: input.document?.trim() || null }
          : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone.trim() } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  /**
   * Company.name não tem UNIQUE no banco (D-0B.6: sem migration nova).
   * Unicidade validada com mode: 'insensitive' do Prisma (case-insensitive;
   * NÃO accent-insensitive — "Empresa" e "Empréza" passam) antes da escrita.
   * Risco residual: corrida entre duas requisições concorrentes —
   * aceitável enquanto a criação for operação restrita ao Admin.
   */
  private async assertNameAvailable(name: string, exceptId?: string): Promise<void> {
    const duplicate = await prisma.company.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new AppError('Já existe uma empresa com este nome', 400);
    }
  }
}

export const companiesService = new CompaniesService();
