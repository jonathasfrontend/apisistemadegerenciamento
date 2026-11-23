-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('CHECKING', 'SAVINGS', 'PAYMENT_ACCOUNT');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('SALE', 'SUPPLY', 'WITHDRAWAL', 'EXPENSE', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "RecurrenceInterval" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('MANUAL', 'RECURRING', 'BANK_RECONCILIATION');

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "installmentGroupId" TEXT,
ADD COLUMN     "installmentNumber" INTEGER,
ADD COLUMN     "installmentTotal" INTEGER,
ADD COLUMN     "isReconciled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paidAmount" DECIMAL(14,2),
ADD COLUMN     "paymentMethod" "PaymentMethod",
ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "recurrenceEndsAt" DATE,
ADD COLUMN     "recurrenceInterval" "RecurrenceInterval",
ADD COLUMN     "recurrenceParentId" TEXT,
ADD COLUMN     "source" "EntrySource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "supplierId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "acquirerId" TEXT,
ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "cashSessionId" TEXT,
ADD COLUMN     "feeAmount" DECIMAL(14,2),
ADD COLUMN     "installments" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "isReconciled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "netAmount" DECIMAL(14,2),
ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "saleId" TEXT,
ADD COLUMN     "source" "EntrySource" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "finance_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requireOpenCashSession" BOOLEAN NOT NULL DEFAULT true,
    "cashClosingTolerance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "matchWindowDays" INTEGER NOT NULL DEFAULT 3,
    "autoConfirmScore" INTEGER,
    "cardTolerancePct" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
    "fileRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "enableOverdueAlerts" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_categories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "CategoryKind" NOT NULL,
    "parentId" TEXT,
    "color" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "systemCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bankCode" TEXT,
    "bankName" TEXT,
    "agency" TEXT,
    "accountNumber" TEXT,
    "type" "BankAccountType" NOT NULL DEFAULT 'CHECKING',
    "ofxBankId" TEXT,
    "ofxAccountId" TEXT,
    "initialBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "initialBalanceDate" DATE NOT NULL,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acquirers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bankKeywords" TEXT[],
    "debitRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "creditRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "creditInstallmentRate" DECIMAL(6,4),
    "installmentRates" JSONB,
    "settlementDaysDebit" INTEGER NOT NULL DEFAULT 1,
    "settlementDaysCredit" INTEGER NOT NULL DEFAULT 30,
    "anticipates" BOOLEAN NOT NULL DEFAULT false,
    "defaultBankAccountId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acquirers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "expectedCash" DECIMAL(14,2),
    "countedCash" DECIMAL(14,2),
    "difference" DECIMAL(14,2),
    "closingNotes" TEXT,
    "summary" JSONB,

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "categoryId" TEXT,
    "paymentId" TEXT,
    "expenseId" TEXT,
    "bankAccountId" TEXT,
    "isReconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "other_incomes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "receivedAt" DATE NOT NULL,
    "categoryId" TEXT,
    "bankAccountId" TEXT,
    "notes" TEXT,
    "source" "EntrySource" NOT NULL DEFAULT 'MANUAL',
    "isReconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "other_incomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_receivables" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "acquirerId" TEXT NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "installmentTotal" INTEGER NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "feeAmount" DECIMAL(14,2) NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "expectedDate" DATE NOT NULL,
    "isReconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledAt" TIMESTAMP(3),

    CONSTRAINT "card_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_settings_companyId_key" ON "finance_settings"("companyId");

-- CreateIndex
CREATE INDEX "financial_categories_companyId_kind_isActive_idx" ON "financial_categories"("companyId", "kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "financial_categories_companyId_kind_name_key" ON "financial_categories"("companyId", "kind", "name");

-- CreateIndex
CREATE INDEX "suppliers_companyId_isActive_idx" ON "suppliers"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "bank_accounts_companyId_isActive_idx" ON "bank_accounts"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "acquirers_companyId_isActive_idx" ON "acquirers"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "cash_registers_companyId_name_key" ON "cash_registers"("companyId", "name");

-- CreateIndex
CREATE INDEX "cash_sessions_companyId_status_idx" ON "cash_sessions"("companyId", "status");

-- CreateIndex
CREATE INDEX "cash_sessions_registerId_status_idx" ON "cash_sessions"("registerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_paymentId_key" ON "cash_movements"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_expenseId_key" ON "cash_movements"("expenseId");

-- CreateIndex
CREATE INDEX "cash_movements_sessionId_voidedAt_idx" ON "cash_movements"("sessionId", "voidedAt");

-- CreateIndex
CREATE INDEX "cash_movements_companyId_occurredAt_idx" ON "cash_movements"("companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "other_incomes_companyId_receivedAt_idx" ON "other_incomes"("companyId", "receivedAt");

-- CreateIndex
CREATE INDEX "card_receivables_companyId_isReconciled_expectedDate_idx" ON "card_receivables"("companyId", "isReconciled", "expectedDate");

-- CreateIndex
CREATE UNIQUE INDEX "card_receivables_paymentId_installmentNumber_key" ON "card_receivables"("paymentId", "installmentNumber");

-- CreateIndex
CREATE INDEX "expenses_companyId_bankAccountId_idx" ON "expenses"("companyId", "bankAccountId");

-- CreateIndex
CREATE INDEX "expenses_companyId_installmentGroupId_idx" ON "expenses"("companyId", "installmentGroupId");

-- CreateIndex
CREATE INDEX "expenses_categoryId_idx" ON "expenses"("categoryId");

-- CreateIndex
CREATE INDEX "expenses_supplierId_idx" ON "expenses"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_recurrenceParentId_due_date_key" ON "expenses"("recurrenceParentId", "due_date");

-- CreateIndex
CREATE INDEX "payments_companyId_bankAccountId_idx" ON "payments"("companyId", "bankAccountId");

-- CreateIndex
CREATE INDEX "payments_companyId_cashSessionId_idx" ON "payments"("companyId", "cashSessionId");

-- CreateIndex
CREATE INDEX "payments_companyId_acquirerId_isReconciled_idx" ON "payments"("companyId", "acquirerId", "isReconciled");

-- CreateIndex
CREATE INDEX "payments_saleId_idx" ON "payments"("saleId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_acquirerId_fkey" FOREIGN KEY ("acquirerId") REFERENCES "acquirers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "cash_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "financial_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurrenceParentId_fkey" FOREIGN KEY ("recurrenceParentId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "financial_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acquirers" ADD CONSTRAINT "acquirers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "financial_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_incomes" ADD CONSTRAINT "other_incomes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_incomes" ADD CONSTRAINT "other_incomes_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "financial_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "other_incomes" ADD CONSTRAINT "other_incomes_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_receivables" ADD CONSTRAINT "card_receivables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_receivables" ADD CONSTRAINT "card_receivables_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_receivables" ADD CONSTRAINT "card_receivables_acquirerId_fkey" FOREIGN KEY ("acquirerId") REFERENCES "acquirers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Apêndice B da spec (I2/I1): não modeláveis no Prisma.
-- Nomes adaptados ao @@map do schema (spec usa nomes de modelo).
-- I2: no máximo 1 sessão OPEN por caixa.
CREATE UNIQUE INDEX "CashSession_one_open_per_register"
  ON "cash_sessions" ("registerId") WHERE "status" = 'OPEN';

-- I1: valor de movimento sempre positivo.
ALTER TABLE "cash_movements"
  ADD CONSTRAINT "CashMovement_amount_positive" CHECK ("amount" > 0);