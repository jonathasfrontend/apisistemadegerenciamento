/** [F1.3] Emissor tipado de eventos financeiros — spec:1032. */
import { financeEvents } from '../../../src/events/finance.events';

describe('financeEvents (F1.3)', () => {
  it('entrega o payload tipado aos listeners registrados no evento', () => {
    const seen: Array<{ paymentId: string; companyId: string }> = [];
    const unsubscribe = financeEvents.on('payment.confirmed', (payload) => {
      seen.push({ paymentId: payload.paymentId, companyId: payload.companyId });
    });

    financeEvents.emit('payment.confirmed', {
      paymentId: 'p-1',
      companyId: 'c-1',
      method: 'CASH',
    });

    expect(seen).toEqual([{ paymentId: 'p-1', companyId: 'c-1' }]);
    unsubscribe();
  });

  it('unsubscribe impede novas entregas', () => {
    let calls = 0;
    const unsubscribe = financeEvents.on('payment.refunded', () => {
      calls += 1;
    });
    const payload = { paymentId: 'p-2', companyId: 'c-2', method: 'CREDIT' as const };

    financeEvents.emit('payment.refunded', payload);
    unsubscribe();
    financeEvents.emit('payment.refunded', payload);

    expect(calls).toBe(1);
  });
});
