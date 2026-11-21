import { NotificationType, Product, StockMovement } from '@prisma/client';
import { createPrismaClient } from '../../../config/db';
import { AppError } from '../../../middlewares/error.handler';
import { notifyResource } from '../notifications/notifications.service';
import { crossedLowStock, notifyLowStock } from './low-stock';
import { runSerializable } from '../../../utils/transaction';

const prisma = createPrismaClient();

interface CreateProductDTO {
  sku: string;
  name: string;
  description?: string;
  category: string;
  quantity: number;
  costPrice: number;
  salePrice: number;
  reorderThreshold?: number;
  supplier?: string;
}

interface UpdateProductDTO {
  sku?: string;
  name?: string;
  description?: string;
  category?: string;
  costPrice?: number;
  salePrice?: number;
  reorderThreshold?: number;
  supplier?: string;
  isActive?: boolean;
}

interface ProductFilters {
  category?: string;
  isActive?: boolean;
  lowStock?: boolean;
  search?: string;
  limit?: number;
}

export class ProductsService {
  // 0B.1: companyId do req.user; SKU é unique composto [companyId, sku].
  async create(data: CreateProductDTO, companyId: string): Promise<Product> {
    const existingProduct = await prisma.product.findFirst({
      where: { companyId, sku: data.sku },
    });

    if (existingProduct) {
      throw new Error('Product with this SKU already exists');
    }

    const product = await prisma.product.create({
      data: {
        ...data,
        companyId,
        reorderThreshold: data.reorderThreshold || 10,
      },
    });

    if (data.quantity > 0) {
      await prisma.stockMovement.create({
        data: {
          companyId,
          productId: product.id,
          type: 'IN',
          quantity: data.quantity,
          reason: 'Initial stock',
        },
      });
    }

    // Avisar Admin + Recepção (best-effort: nunca derruba a criação do produto)
    await notifyResource(
      {
        type: NotificationType.NEW_PRODUCT,
        message: `Novo produto cadastrado: ${product.name} (${product.sku})`,
        link: `/products/${product.id}`,
        dedupeKey: `NEW_PRODUCT:${product.id}`,
      },
      { roleNames: ['Admin', 'Recepção'] },
      companyId
    );

    if (product.quantity <= product.reorderThreshold) {
      await notifyLowStock(product, 'create', companyId);
    }

    return product;
  }

  async list(filters: ProductFilters = {}, companyId: string): Promise<Product[]> {
    const where: any = { companyId };

    if (filters.category) {
      where.category = filters.category;
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.lowStock) {
      where.quantity = {
        lte: prisma.product.fields.reorderThreshold,
      };
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { sku: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return await prisma.product.findMany({
      where,
      orderBy: [
        { category: 'asc' },
        { name: 'asc' },
      ],
      ...(filters.limit ? { take: filters.limit } : {}),
    });
  }

  async getById(id: string, companyId: string): Promise<Product | null> {
    return await prisma.product.findFirst({
      where: { id, companyId },
      include: {
        _count: {
          select: {
            stockMovements: true,
            saleItems: true,
          },
        },
      },
    });
  }

  async update(id: string, data: UpdateProductDTO, companyId: string): Promise<Product> {
    const existing = await this.getById(id, companyId);
    if (!existing) throw new AppError('Product not found', 404);

    if (data.sku) {
      const duplicate = await prisma.product.findFirst({
        where: { companyId, sku: data.sku, NOT: { id } },
      });

      if (duplicate) {
        throw new Error('Product with this SKU already exists');
      }
    }

    return await prisma.product.update({
      where: { id },
      data,
    });
  }

  /** Deletar produto (soft delete) */
  async delete(id: string, companyId: string): Promise<Product> {
    const existing = await this.getById(id, companyId);
    if (!existing) throw new AppError('Product not found', 404);

    return await prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async addStock(
    productId: string,
    quantity: number,
    companyId: string,
    reason?: string,
    reference?: string
  ): Promise<Product> {
    const product = await this.getById(productId, companyId);
    if (!product) throw new AppError('Product not found', 404);

    const updated = await prisma.product.update({
      where: { id: productId },
      data: { quantity: { increment: quantity } },
    });

    await prisma.stockMovement.create({
      data: {
        companyId,
        productId,
        type: 'IN',
        quantity,
        reason,
        reference,
      },
    });

    return updated;
  }

  /**
   * Leitura do saldo + decremento em transação SERIALIZABLE.
   * 0B.1: companyId escopa produto e movimentação.
   */
  async removeStock(
    productId: string,
    quantity: number,
    companyId: string,
    reason?: string,
    reference?: string
  ): Promise<Product> {
    const { updatedProduct, crossed } = await runSerializable(prisma, async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, companyId },
      });

      if (!product) {
        throw new Error('Product not found');
      }

      if (product.quantity < quantity) {
        throw new Error('Insufficient stock');
      }

      const updated = await tx.product.update({
        where: { id: productId },
        data: { quantity: { decrement: quantity } },
      });

      const movement = await tx.stockMovement.create({
        data: {
          companyId,
          productId,
          type: 'OUT',
          quantity,
          reason,
          reference,
        },
      });

      const didCross = crossedLowStock(
        product.quantity,
        updated.quantity,
        updated.reorderThreshold
      );

      return { updatedProduct: updated, crossed: didCross ? movement.id : null };
    });

    if (crossed) {
      await notifyLowStock(updatedProduct, crossed, companyId);
    }

    return updatedProduct;
  }

  async getMovements(productId: string, companyId: string): Promise<StockMovement[]> {
    return await prisma.stockMovement.findMany({
      where: { productId, companyId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
