import { NotificationType, Product, StockMovement } from '@prisma/client';
import { createPrismaClient } from '../../../config/db';
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
  /**
   * Criar um novo produto
   */
  async create(data: CreateProductDTO): Promise<Product> {
    // Verificar se SKU já existe
    const existingProduct = await prisma.product.findUnique({
      where: { sku: data.sku },
    });

    if (existingProduct) {
      throw new Error('Product with this SKU already exists');
    }

    const product = await prisma.product.create({
      data: {
        sku: data.sku,
        name: data.name,
        description: data.description,
        category: data.category,
        quantity: data.quantity,
        costPrice: data.costPrice,
        salePrice: data.salePrice,
        reorderThreshold: data.reorderThreshold || 10,
        supplier: data.supplier,
      },
    });

    // Registrar movimentação inicial de estoque
    if (data.quantity > 0) {
      await prisma.stockMovement.create({
        data: {
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
      { roleNames: ['Admin', 'Recepção'] }
    );

    // Produto já criado abaixo do limite de reposição
    if (product.quantity <= product.reorderThreshold) {
      await notifyLowStock(product, 'create');
    }

    return product;
  }

  /**
   * Listar produtos com filtros
   */
  async list(filters: ProductFilters = {}): Promise<Product[]> {
    const where: any = {};
    
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
      // Limite opcional: usado pela busca global para não puxar a tabela inteira
      ...(filters.limit ? { take: filters.limit } : {}),
    });
  }

  /**
   * Buscar produto por ID
   */
  async getById(id: string): Promise<Product | null> {
    return await prisma.product.findUnique({
      where: { id },
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

  /**
   * Atualizar produto
   */
  async update(id: string, data: UpdateProductDTO): Promise<Product> {
    // Se estiver alterando o SKU, verificar se já existe
    if (data.sku) {
      const existingProduct = await prisma.product.findFirst({
        where: {
          sku: data.sku,
          NOT: { id },
        },
      });

      if (existingProduct) {
        throw new Error('Product with this SKU already exists');
      }
    }

    return await prisma.product.update({
      where: { id },
      data,
    });
  }

  /**
   * Deletar produto (soft delete)
   */
  async delete(id: string): Promise<Product> {
    return await prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Adicionar estoque
   */
  async addStock(
    productId: string,
    quantity: number,
    reason?: string,
    reference?: string
  ): Promise<Product> {
    const product = await prisma.product.update({
      where: { id: productId },
      data: {
        quantity: {
          increment: quantity,
        },
      },
    });

    await prisma.stockMovement.create({
      data: {
        productId,
        type: 'IN',
        quantity,
        reason,
        reference,
      },
    });

    return product;
  }

  /**
   * Remover estoque
   *
   * A leitura do saldo + decremento rodam em transação SERIALIZABLE: duas
   * saídas concorrentes do mesmo produto não podem calcular a travessia do
   * limite a partir do mesmo estado (evita dois avisos de estoque baixo).
   */
  async removeStock(
    productId: string,
    quantity: number,
    reason?: string,
    reference?: string
  ): Promise<Product> {
    const { updatedProduct, crossed } = await runSerializable(prisma, async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new Error('Product not found');
      }

      if (product.quantity < quantity) {
        throw new Error('Insufficient stock');
      }

      const updated = await tx.product.update({
        where: { id: productId },
        data: {
          quantity: {
            decrement: quantity,
          },
        },
      });

      const movement = await tx.stockMovement.create({
        data: {
          productId,
          type: 'OUT',
          quantity,
          reason,
          reference,
        },
      });

      // Aviso de estoque baixo só na travessia do limite
      const didCross = crossedLowStock(
        product.quantity,
        updated.quantity,
        updated.reorderThreshold
      );

      return { updatedProduct: updated, crossed: didCross ? movement.id : null };
    });

    // Avisar depois do commit — notificação é best-effort
    if (crossed) {
      await notifyLowStock(updatedProduct, crossed);
    }

    return updatedProduct;
  }

  /**
   * Obter histórico de movimentações
   */
  async getMovements(productId: string): Promise<StockMovement[]> {
    return await prisma.stockMovement.findMany({
      where: { productId },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });
  }
}
