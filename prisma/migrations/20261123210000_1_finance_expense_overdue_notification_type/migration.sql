-- F1.7: alerta de vencimento de despesa (idempotente).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'EXPENSE_OVERDUE';
