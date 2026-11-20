import prisma from '../../../config/db';
import { AppError } from '../../../middlewares/error.handler';

type ClientWhereInput = {
  OR?: Array<{
    name?: { contains: string; mode: 'insensitive' };
    phone?: { contains: string };
    email?: { contains: string; mode: 'insensitive' };
  }>;
  isBlocked?: boolean;
};

interface CreateClientInput {
  name: string;
  phone: string;
  email?: string;
  birthdate?: Date;
  cpf?: string;
  notes?: string;
  preferences?: any;
  consentLGPD?: boolean;
}

interface UpdateClientInput {
  name?: string;
  phone?: string;
  email?: string;
  birthdate?: Date;
  cpf?: string;
  notes?: string;
  preferences?: any;
  isBlocked?: boolean;
}

/**
 * Escapa uma célula CSV.
 * Além de aspas/quebras de linha, neutraliza fórmulas de planilha
 * (=, +, -, @, TAB, CR) prefixando apóstrofo — evita CSV injection
 * (formula injection) ao abrir no Excel/Sheets.
 */
function escapeCsvCell(value: unknown): string {
  let text = String(value ?? '').replace(/[\r\n]+/g, ' ');

  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export class ClientService {
  async create(data: CreateClientInput) {
    // Check if phone already exists
    const existingClient = await prisma.client.findUnique({
      where: { phone: data.phone },
    });

    if (existingClient) {
      throw new AppError('Phone number already registered', 400);
    }

    // Check CPF if provided
    if (data.cpf) {
      const existingCPF = await prisma.client.findUnique({
        where: { cpf: data.cpf },
      });

      if (existingCPF) {
        throw new AppError('CPF already registered', 400);
      }
    }

    const client = await prisma.client.create({
      data: {
        ...data,
        consentDate: data.consentLGPD ? new Date() : null,
      },
    });

    return client;
  }

  async findAll(params: {
    page?: number;
    limit?: number;
    search?: string;
    isBlocked?: boolean;
  }) {
    const { page = 1, limit = 20, search, isBlocked } = params;
    const skip = (page - 1) * limit;

    const where: ClientWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (isBlocked !== undefined) {
      where.isBlocked = isBlocked;
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: {
              appointments: true,
              payments: true,
            },
          },
        },
      }),
      prisma.client.count({ where }),
    ]);

    return {
      data: clients,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Exportação de clientes em CSV, gerada no servidor.
   * Sem paginação: o arquivo contém todos os registros do tenant.
   */
  async exportCsv(): Promise<{ csv: string; count: number }> {
    const clients = await prisma.client.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        name: true,
        phone: true,
        email: true,
        cpf: true,
        loyaltyPoints: true,
        isBlocked: true,
        createdAt: true,
      },
    });

    const header = 'Nome;Telefone;Email;CPF;Pontos;Bloqueado;Criado em';

    // Timezone explícito: o servidor pode rodar em UTC e "virar o dia"
    // errado para quem registrou o cliente à noite em São Paulo.
    const createdAtFormatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
    });

    const rows = clients.map((c) =>
      [
        c.name,
        c.phone,
        c.email ?? '',
        c.cpf ?? '',
        c.loyaltyPoints ?? 0,
        c.isBlocked ? 'Sim' : 'Não',
        createdAtFormatter.format(new Date(c.createdAt)),
      ]
        .map((value) => escapeCsvCell(value))
        .join(';')
    );

    // BOM para o Excel reconhecer UTF-8
    const csv = '\uFEFF' + [header, ...rows].join('\r\n');

    return { csv, count: clients.length };
  }

  async findById(id: string) {
    const client = await prisma.client.findUnique({
      where: { id },
      include: {
        appointments: {
          take: 10,
          orderBy: { startTime: 'desc' },
          include: {
            staff: {
              include: {
                user: {
                  select: { name: true },
                },
              },
            },
          },
        },
        payments: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        reviews: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!client) {
      throw new AppError('Client not found', 404);
    }

    return client;
  }

  async update(id: string, data: UpdateClientInput) {
    const client = await prisma.client.findUnique({
      where: { id },
    });

    if (!client) {
      throw new AppError('Client not found', 404);
    }

    // Check if phone is being changed and already exists
    if (data.phone && data.phone !== client.phone) {
      const existingPhone = await prisma.client.findUnique({
        where: { phone: data.phone },
      });

      if (existingPhone) {
        throw new AppError('Phone number already in use', 400);
      }
    }

    const updated = await prisma.client.update({
      where: { id },
      data,
    });

    return updated;
  }

  async delete(id: string) {
    const client = await prisma.client.findUnique({
      where: { id },
    });

    if (!client) {
      throw new AppError('Client not found', 404);
    }

    await prisma.client.delete({
      where: { id },
    });

    return { message: 'Client deleted successfully' };
  }

  async getHistory(id: string) {
    const client = await prisma.client.findUnique({
      where: { id },
    });

    if (!client) {
      throw new AppError('Client not found', 404);
    }

    const [appointments, payments, totalSpent] = await Promise.all([
      prisma.appointment.findMany({
        where: { clientId: id },
        orderBy: { startTime: 'desc' },
        include: {
          staff: {
            include: {
              user: { select: { name: true } },
            },
          },
        },
      }),
      prisma.payment.findMany({
        where: { clientId: id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.aggregate({
        where: {
          clientId: id,
          status: 'PAID',
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    return {
      client,
      appointments,
      payments,
      totalSpent: totalSpent._sum.amount || 0,
    };
  }

  async markNoShow(id: string) {
    const client = await prisma.client.update({
      where: { id },
      data: {
        noShowCount: {
          increment: 1,
        },
      },
    });

    // Auto-block if too many no-shows
    if (client.noShowCount >= 3) {
      await prisma.client.update({
        where: { id },
        data: { isBlocked: true },
      });
    }

    return client;
  }

  async getInactiveClients(daysInactive: number = 60) {
    const date = new Date();
    date.setDate(date.getDate() - daysInactive);

    const clients = await prisma.client.findMany({
      where: {
        appointments: {
          every: {
            startTime: {
              lt: date,
            },
          },
        },
      },
      include: {
        appointments: {
          take: 1,
          orderBy: { startTime: 'desc' },
        },
      },
    });

    return clients;
  }
}
