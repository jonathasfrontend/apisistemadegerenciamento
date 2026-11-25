/**
 * [F2.5] Revisão 2 — concorrência de createEntry/undo e ordem de locks.
 *
 * Determinístico: os mocks devolvem o estado que o banco devolveria na
 * condição de corrida. Nenhum teste depende de timing de duas requisições.
 */
import prisma from '../../../src/config/db';
import { fromCents } from '../../../src/domain/finance/money';
import {
  createEntry,
  reconcile,
  undo,
} from '../../../src/domain/finance/reconciliation/engine';

jest.mock('../../../src/config/db', () => ({
  __esModule: true,
  default: {
    bankTransaction: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    financialCategory: { findFirst: jest.fn() },
    supplier: { findFirst: jest.fn() },
    expense: {
      create: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
    otherIncome: {
      create: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
    payment: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    cardReceivable: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    cashMovement: { findFirst: jest.fn(), updateMany: jest.fn() },
    reconciliation: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      aggregate: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const makeDb = () => ({
  bankTransaction: {
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  reconciliation: {
    create: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
  },
  expense: {
    create: jest.fn(),
    findFirst: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  otherIncome: {
    create: jest.fn(),
    findFirst: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  payment: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  cardReceivable: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  cashMovement: {
    findFirst: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
  acquirer: { findMany: jest.fn().mockResolvedValue([]) },
  auditLog: { create: jest.fn().mockResolvedValue({}) },
});

const baseTx = (overrides: Record<string, unknown> = {}) => ({
  id: 'tx-1',
  companyId: 'c1',
  amount: fromCents(-10000),
  status: 'PENDING',
  reconciledAmount: fromCents(0),
  bankAccountId: 'acc-1',
  postedAt: new Date('2026-11-18T00:00:00.000Z'),
  reconciliations: [],
  ...overrides,
});

describe('concorrência da reconciliação (revisão 2 de 98291b5)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('createEntry reclama o slot antes de criar o lançamento', async () => {
    (prisma.bankTransaction.findFirst as jest.Mock).mockResolvedValue(baseTx());
    (prisma.financialCategory.findFirst as jest.Mock).mockResolvedValue({
      id: 'cat-1',
      kind: 'EXPENSE',
    });
    const db = makeDb();
    const order: string[] = [];
    db.bankTransaction.updateMany.mockImplementation(async () => {
      order.push('claim');
      return { count: 1 };
    });
    db.expense.create.mockImplementation(async () => {
      order.push('entry');
      return { id: 'exp-1', source: 'BANK_RECONCILIATION' };
    });
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(db));

    await createEntry('c1', 'u1', 'tx-1', { description: 'Tarifa', categoryId: 'cat-1' });

    expect(order).toEqual(['claim', 'entry']);
  });

  it('undo aborta 409 se surge reconciliação entre a leitura e a transação', async () => {
    // Snapshot lido fora da transação diz "nada conciliado".
    (prisma.bankTransaction.findFirst as jest.Mock).mockResolvedValue(
      baseTx({ status: 'RECONCILED', reconciledAmount: fromCents(10000) })
    );
    const db = makeDb();
    // Mas, ao entrar na transação, existe uma linha nova.
    db.reconciliation.findMany.mockResolvedValue([
      {
        id: 'new-1',
        targetType: 'PAYMENT',
        paymentId: 'p1',
        amount: fromCents(5000),
      },
    ]);
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(db));

    await expect(undo('c1', 'u1', 'tx-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'RECONCILE_CONFLICT',
    });
  });

  it('undo reclama o slot da linha pai antes de revalidar as reconciliações', async () => {
    (prisma.bankTransaction.findFirst as jest.Mock).mockResolvedValue(
      baseTx({ status: 'RECONCILED', reconciledAmount: fromCents(10000) })
    );
    const db = makeDb();
    const order: string[] = [];
    db.bankTransaction.updateMany.mockImplementation(async () => {
      order.push('claim');
      return { count: 1 };
    });
    db.reconciliation.findMany.mockImplementation(async () => {
      order.push('check');
      return [];
    });
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(db));

    await undo('c1', 'u1', 'tx-1');

    expect(order.slice(0, 2)).toEqual(['claim', 'check']);
  });

  it('undo adquire locks em ordem de id estável (current e pares)', async () => {
    (prisma.bankTransaction.findFirst as jest.Mock).mockResolvedValue(
      baseTx({
        id: 'B',
        status: 'RECONCILED',
        reconciledAmount: fromCents(10000),
        reconciliations: [
          {
            id: 'mirror-1',
            targetType: 'TRANSFER',
            pairTransactionId: 'A',
            amount: fromCents(10000),
          },
        ],
      })
    );
    const db = makeDb();
    db.bankTransaction.findMany.mockResolvedValue([
      { id: 'A', reconciledAmount: fromCents(10000) },
    ]);
    db.reconciliation.findMany.mockResolvedValue([{ id: 'mirror-1' }]);
    const claimed: string[] = [];
    db.bankTransaction.updateMany.mockImplementation(async (args: any) => {
      if (args.where?.reconciledAmount) claimed.push(args.where.id);
      return { count: 1 };
    });
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(db));

    await undo('c1', 'u1', 'B');

    expect(claimed).toEqual(['A', 'B']);
  });

  it('reconcile adquire os locks em ordem de id estável (current e par)', async () => {
    // current = "B", par = "A": a ordem estável exige A antes de B.
    // 1ª chamada = ownedTx (current B); 2ª = resolveTarget (par A);
    // 3ª em diante = reload. Sem isso o mock devolvia B como par e a
    // validação de transferência abortava antes de chegar aos locks.
    const findFirst = prisma.bankTransaction.findFirst as jest.Mock;
    findFirst
      .mockResolvedValueOnce(baseTx({ id: 'B', bankAccountId: 'acc-B' }))
      .mockResolvedValueOnce({
        id: 'A',
        amount: fromCents(10000),
        bankAccountId: 'acc-A',
        transferPairId: null,
        reconciliations: [],
      })
      .mockResolvedValue(baseTx({ id: 'B', bankAccountId: 'acc-B' }));
    const db = makeDb();
    const claimed: string[] = [];
    db.bankTransaction.updateMany.mockImplementation(async (args: any) => {
      if (args.where?.reconciledAmount) claimed.push(args.where.id);
      return { count: 1 };
    });
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(db));

    await reconcile('c1', 'u1', 'B', {
      targets: [{ targetType: 'TRANSFER', targetId: 'A', amount: 100 }],
    });

    expect(claimed).toEqual(['A', 'B']);
  });
});
