/**
 * [F1.7] Jobs de recorrência e alerta de vencimento — spec:1157-1163.
 * Testa runners diretos (sem BullMQ/Redis real). Idempotência por dedupe/skipDuplicates.
 */
import prisma from '../../../src/config/db';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

describe('finance jobs (finance F1.7)', () => {
  let fixture: TenantFixture;
  let adminAId: string;

  beforeAll(async () => {
    fixture = await seedTwoTenants();
    adminAId = fixture.userAId;

    // Limpa pagamentos seedados para isolar contagens.
    await prisma.payment.deleteMany({
      where: { id: { in: [fixture.paymentAId, fixture.paymentBId] } },
    });
  });

  it('recorrência: rodar 2x não duplica ocorrências', async () => {
    const { runFinanceRecurring } = await import('../../../src/jobs/finance-recurring');

    const parent = await prisma.expense.create({
      data: {
        companyId: fixture.companyAId,
        description: `Recorrente Job ${fixture.suffix}`,
        category: 'aluguel',
        amount: 100,
        dueDate: new Date('2026-11-10T12:00:00Z'),
        recurrenceInterval: 'MONTHLY',
        isRecurring: true,
        source: 'MANUAL',
      },
    });

    const now = new Date('2026-11-23T12:00:00Z');
    const first = await runFinanceRecurring(now, [fixture.companyAId, fixture.companyBId]);
    const second = await runFinanceRecurring(now, [fixture.companyAId, fixture.companyBId]);

    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);

    const count = await prisma.expense.count({
      where: { companyId: fixture.companyAId, recurrenceParentId: parent.id },
    });
    expect(count).toBe(first.created);

    // Tenant B não deve receber nada deste parent.
    const b = await prisma.expense.count({
      where: { companyId: fixture.companyBId, recurrenceParentId: parent.id },
    });
    expect(b).toBe(0);
  });

  it('alerta de vencimento: cria notificação in-app para despesa vencida', async () => {
    const { runFinanceOverdue } = await import('../../../src/jobs/finance-overdue');

    await prisma.financeSettings.upsert({
      where: { companyId: fixture.companyAId },
      create: { companyId: fixture.companyAId, enableOverdueAlerts: true },
      update: { enableOverdueAlerts: true },
    });

    const expense = await prisma.expense.create({
      data: {
        companyId: fixture.companyAId,
        description: `Vencida Job ${fixture.suffix}`,
        category: 'outros',
        amount: 55,
        dueDate: new Date('2026-11-20T12:00:00Z'),
        isPaid: false,
        source: 'MANUAL',
      },
    });

    const now = new Date('2026-11-23T12:00:00Z');
    const first = await runFinanceOverdue(now, [fixture.companyAId]);
    expect(first.notified).toBeGreaterThan(0);

    const notifications = await prisma.notification.findMany({
      where: {
        companyId: fixture.companyAId,
        userId: adminAId,
        dedupeKey: `expense-overdue:${expense.id}:2026-11-23`,
      },
    });
    expect(notifications.length).toBe(1);

    const second = await runFinanceOverdue(now, [fixture.companyAId]);
    expect(second.notified).toBe(0);
  }, 30000);

  it('alerta de vencimento off → 0 notificações', async () => {
    const { runFinanceOverdue } = await import('../../../src/jobs/finance-overdue');

    await prisma.financeSettings.upsert({
      where: { companyId: fixture.companyBId },
      create: { companyId: fixture.companyBId, enableOverdueAlerts: false },
      update: { enableOverdueAlerts: false },
    });

    const expenseB = await prisma.expense.create({
      data: {
        companyId: fixture.companyBId,
        description: `Vencida B ${fixture.suffix}`,
        category: 'outros',
        amount: 77,
        dueDate: new Date('2026-11-20T12:00:00Z'),
        isPaid: false,
        source: 'MANUAL',
      },
    });

    const before = await prisma.notification.count({ where: { companyId: fixture.companyBId } });
    await runFinanceOverdue(new Date('2026-11-23T12:00:00Z'), [fixture.companyBId]);
    const after = await prisma.notification.count({ where: { companyId: fixture.companyBId } });

    expect(after).toBe(before);
    const expenseNotifs = await prisma.notification.count({
      where: { companyId: fixture.companyBId, dedupeKey: { contains: expenseB.id } },
    });
    expect(expenseNotifs).toBe(0);
  }, 30000);
});