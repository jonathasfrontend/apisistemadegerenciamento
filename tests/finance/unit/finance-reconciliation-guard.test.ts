/**
 * [F2.5] Guarda de concorrência da reconciliação — revisão de 98291b5.
 *
 * Teste determinístico: não depende de race timing. Simula o `count === 0`
 * que o Postgres devolve quando outra transação já alterou `reconciledAmount`.
 */
import { claimReconciliationSlot } from '../../../src/domain/finance/reconciliation/engine';

describe('claimReconciliationSlot (F2.5)', () => {
  const companyId = 'company-1';
  const id = 'tx-1';

  it('rejeita com 409 quando outra escrita já mudou o valor conciliado', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const db = { bankTransaction: { updateMany } } as any;

    await expect(claimReconciliationSlot(db, companyId, id, 5000)).rejects.toMatchObject({
      statusCode: 409,
      code: 'RECONCILE_CONFLICT',
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id,
          companyId,
          reconciledAmount: { equals: expect.anything() },
        },
      })
    );
  });

  it('segue quando o valor ainda é o esperado', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const db = { bankTransaction: { updateMany } } as any;

    await expect(claimReconciliationSlot(db, companyId, id, 5000)).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
