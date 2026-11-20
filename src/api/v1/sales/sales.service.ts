import { PaymentMethod, Sale } from '@prisma/client';
import { createPrismaClient } from '../../../config/db';
import { runSerializable } from '../../../utils/transaction';
import { crossedLowStock, LowStockProduct, notifyLowStock } from '../products/low-stock';

const prisma = createPrismaClient();

interface CreateSaleDTO {
  clientId?: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
  }>;
  paymentMethod: PaymentMethod;
}

interface SaleFilters {
  clientId?: string;
  dateRange?: {
    start?: Date;
    end?: Date;
  };
}

export class SalesService {
  async create(data: CreateSaleDTO): Promise<Sale> {
    const totalAmount = data.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

    const sale = await runSerializable(prisma, async (tx) => {
      // Vendas que cruzam o limite de reposição (aviso só depois do commit)
      const lowStockEvents: { product: LowStockProduct; eventId: string }[] = [];

      // Criar venda
      const newSale = await tx.sale.create({
        data: {
          clientId: data.clientId,
          totalAmount,
          paymentMethod: data.paymentMethod,
          items: {
            create: data.items.map(item => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.quantity * item.unitPrice,
            })),
          },
        },
        include: {
          items: {
            include: {
              product: true,
            },
          },
          client: true,
        },
      });

      // Atualizar estoque
      for (const item of data.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        if (!product || product.quantity < item.quantity) {
          throw new Error(`Insufficient stock for product ${item.productId}`);
        }

        const updatedProduct = await tx.product.update({
          where: { id: item.productId },
          data: {
            quantity: {
              decrement: item.quantity,
            },
          },
        });

        // Registrar movimentação de estoque
        const movement = await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'OUT',
            quantity: item.quantity,
            reason: 'Sale',
            reference: newSale.id,
          },
        });

        // Aviso de estoque baixo só na travessia do limite
        if (crossedLowStock(product.quantity, updatedProduct.quantity, updatedProduct.reorderThreshold)) {
          lowStockEvents.push({ product: updatedProduct, eventId: movement.id });
        }
      }

      return { sale: newSale, lowStockEvents };
    });

    // Avisar depois do commit — notificação é best-effort
    for (const event of sale.lowStockEvents) {
      await notifyLowStock(event.product, event.eventId);
    }

    return sale.sale;
  }

  async list(filters: SaleFilters = {}): Promise<Sale[]> {
    const where: any = {};
    
    if (filters.clientId) {
      where.clientId = filters.clientId;
    }
    
    if (filters.dateRange) {
      where.createdAt = {};
      if (filters.dateRange.start) {
        where.createdAt.gte = filters.dateRange.start;
      }
      if (filters.dateRange.end) {
        where.createdAt.lte = filters.dateRange.end;
      }
    }

    return await prisma.sale.findMany({
      where,
      include: {
        items: {
          include: {
            product: true,
          },
        },
        client: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getById(id: string): Promise<Sale | null> {
    return await prisma.sale.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        client: true,
      },
    });
  }
}
