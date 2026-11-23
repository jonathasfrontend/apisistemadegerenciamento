/**
 * [F1.3] Emissor tipado de eventos financeiros — spec:1032.
 * Os hooks publicam eventos após a escrita transacional; listeners são
 * best-effort e nunca participam da decisão de commit.
 */
import { PaymentMethod } from '@prisma/client';

export interface PaymentConfirmedPayload {
  paymentId: string;
  companyId: string;
  method: PaymentMethod;
}

export interface PaymentRefundedPayload {
  paymentId: string;
  companyId: string;
  method: PaymentMethod;
}

export interface FinanceEventMap {
  'payment.confirmed': PaymentConfirmedPayload;
  'payment.refunded': PaymentRefundedPayload;
}

type Listener<K extends keyof FinanceEventMap> = (payload: FinanceEventMap[K]) => void;

class FinanceEventEmitter {
  private listeners: { [K in keyof FinanceEventMap]?: Set<Listener<K>> } = {};

  on<K extends keyof FinanceEventMap>(event: K, listener: Listener<K>): () => void {
    const set = (this.listeners[event] ??= new Set<Listener<K>>() as never);
    set.add(listener);
    return () => set.delete(listener);
  }

  emit<K extends keyof FinanceEventMap>(event: K, payload: FinanceEventMap[K]): void {
    this.listeners[event]?.forEach((listener) => {
      try {
        (listener as Listener<K>)(payload);
      } catch {
        // best-effort: um listener quebrado não desfaz o pagamento confirmado.
      }
    });
  }
}

export const financeEvents = new FinanceEventEmitter();
