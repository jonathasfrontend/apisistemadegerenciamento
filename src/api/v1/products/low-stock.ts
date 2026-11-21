import { NotificationType } from '@prisma/client';
import { notifyResource } from '../notifications/notifications.service';

export interface LowStockProduct {
  id: string;
  name: string;
  quantity: number;
  reorderThreshold: number;
}

/**
 * O aviso de estoque baixo só dispara na TRAVESSIA do limite
 * (de `quantidade > limite` para `quantidade <= limite`).
 * Decrementos que continuam abaixo do limite não geram novo aviso.
 */
export const crossedLowStock = (
  before: number,
  after: number,
  threshold: number
): boolean => before > threshold && after <= threshold;

/**
 * Avisa Admin + Recepção que o estoque ficou baixo.
 * `eventId` identifica a movimentação (única por evento) — evita duplicata
 * quando o mesmo evento é processado mais de uma vez.
 */
export const notifyLowStock = async (
  product: LowStockProduct,
  eventId: string,
  companyId: string
): Promise<void> => {
  await notifyResource(
    {
      type: NotificationType.LOW_STOCK,
      message: `Estoque baixo: ${product.name} — ${product.quantity} em estoque (limite ${product.reorderThreshold})`,
      link: `/products/${product.id}`,
      dedupeKey: `LOW_STOCK:${product.id}:${eventId}`,
    },
    { roleNames: ['Admin', 'Recepção'] },
    companyId
  );
};
