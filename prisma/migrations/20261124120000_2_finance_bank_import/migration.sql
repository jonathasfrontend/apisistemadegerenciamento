-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('BANK_STATEMENT', 'CREDIT_CARD_INVOICE');

-- CreateEnum
CREATE TYPE "ImportFormat" AS ENUM ('OFX', 'PDF');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'NEEDS_REVIEW', 'CONFIRMED', 'FAILED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "BalanceCheck" AS ENUM ('OK', 'MISMATCH', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "BankTxSource" AS ENUM ('OFX', 'PDF', 'MANUAL');

-- CreateEnum
CREATE TYPE "BankTxMethod" AS ENUM ('PIX', 'TED', 'DOC', 'BOLETO', 'CARD_SETTLEMENT', 'FEE', 'INTEREST', 'CASH_DEPOSIT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReconStatus" AS ENUM ('PENDING', 'SUGGESTED', 'PARTIAL', 'RECONCILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ReconTargetType" AS ENUM ('PAYMENT', 'CARD_RECEIVABLE', 'EXPENSE', 'OTHER_INCOME', 'CASH_MOVEMENT', 'CARD_INVOICE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "ReconOrigin" AS ENUM ('AUTO', 'RULE', 'MANUAL');

-- CreateEnum
CREATE TYPE "RuleMatchType" AS ENUM ('CONTAINS', 'STARTS_WITH', 'REGEX');

-- CreateEnum
CREATE TYPE "RuleDirection" AS ENUM ('IN', 'OUT', 'ANY');

-- CreateEnum
CREATE TYPE "RuleAction" AS ENUM ('SET_CATEGORY', 'CREATE_ENTRY', 'IGNORE');

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "lastImportAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL DEFAULT 'BANK_STATEMENT',
    "format" "ImportFormat" NOT NULL DEFAULT 'OFX',
    "bankAccountId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "storageKey" TEXT,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "parserId" TEXT,
    "invertSigns" BOOLEAN NOT NULL DEFAULT false,
    "periodStart" DATE,
    "periodEnd" DATE,
    "statementStartBalance" DECIMAL(14,2),
    "statementEndBalance" DECIMAL(14,2),
    "computedEndBalance" DECIMAL(14,2),
    "balanceCheck" "BalanceCheck" NOT NULL DEFAULT 'UNAVAILABLE',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "newRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "errorMessage" TEXT,
    "uploadedById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "postedAt" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "memo" TEXT,
    "externalId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "normalizedDescription" TEXT NOT NULL,
    "inferredMethod" "BankTxMethod" NOT NULL DEFAULT 'OTHER',
    "installmentNumber" INTEGER,
    "installmentTotal" INTEGER,
    "raw" JSONB,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "possibleDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "isIgnored" BOOLEAN NOT NULL DEFAULT false,
    "warnings" TEXT[],

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "source" "BankTxSource" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "externalId" TEXT,
    "postedAt" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "normalizedDescription" TEXT NOT NULL,
    "memo" TEXT,
    "counterpartyName" TEXT,
    "inferredMethod" "BankTxMethod" NOT NULL DEFAULT 'OTHER',
    "status" "ReconStatus" NOT NULL DEFAULT 'PENDING',
    "reconciledAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "categoryId" TEXT,
    "notes" TEXT,
    "transferPairId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "targetType" "ReconTargetType" NOT NULL,
    "paymentId" TEXT,
    "cardReceivableId" TEXT,
    "expenseId" TEXT,
    "otherIncomeId" TEXT,
    "cashMovementId" TEXT,
    "pairTransactionId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "score" INTEGER,
    "origin" "ReconOrigin" NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "matchType" "RuleMatchType" NOT NULL,
    "pattern" TEXT NOT NULL,
    "direction" "RuleDirection" NOT NULL DEFAULT 'ANY',
    "minAmount" DECIMAL(14,2),
    "maxAmount" DECIMAL(14,2),
    "bankAccountId" TEXT,
    "action" "RuleAction" NOT NULL,
    "categoryId" TEXT,
    "supplierId" TEXT,
    "entryDescription" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_companyId_status_createdAt_idx" ON "import_batches"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "import_batches_companyId_fileHash_idx" ON "import_batches"("companyId", "fileHash");

-- CreateIndex
CREATE INDEX "import_rows_batchId_isDuplicate_idx" ON "import_rows"("batchId", "isDuplicate");

-- CreateIndex
CREATE INDEX "import_rows_batchId_isIgnored_idx" ON "import_rows"("batchId", "isIgnored");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batchId_rowIndex_key" ON "import_rows"("batchId", "rowIndex");

-- CreateIndex
CREATE INDEX "bank_transactions_companyId_bankAccountId_postedAt_idx" ON "bank_transactions"("companyId", "bankAccountId", "postedAt");

-- CreateIndex
CREATE INDEX "bank_transactions_companyId_status_postedAt_idx" ON "bank_transactions"("companyId", "status", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_bankAccountId_dedupeKey_key" ON "bank_transactions"("bankAccountId", "dedupeKey");

-- CreateIndex
CREATE INDEX "reconciliations_companyId_bankTransactionId_idx" ON "reconciliations"("companyId", "bankTransactionId");

-- CreateIndex
CREATE INDEX "reconciliations_companyId_targetType_idx" ON "reconciliations"("companyId", "targetType");

-- CreateIndex
CREATE INDEX "reconciliation_rules_companyId_isActive_priority_idx" ON "reconciliation_rules"("companyId", "isActive", "priority");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "financial_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_transferPairId_fkey" FOREIGN KEY ("transferPairId") REFERENCES "bank_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "bank_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_cardReceivableId_fkey" FOREIGN KEY ("cardReceivableId") REFERENCES "card_receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_otherIncomeId_fkey" FOREIGN KEY ("otherIncomeId") REFERENCES "other_incomes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_cashMovementId_fkey" FOREIGN KEY ("cashMovementId") REFERENCES "cash_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_rules" ADD CONSTRAINT "reconciliation_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_rules" ADD CONSTRAINT "reconciliation_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "financial_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_rules" ADD CONSTRAINT "reconciliation_rules_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Appendix B of the spec (FINANCEIRO_IMPLEMENTACAO.md:2416-2429): not modelable in Prisma.
-- Names adapted to the schema @@map (the spec uses model names).
-- I3: the reconciled portion is always positive.
ALTER TABLE "reconciliations"
  ADD CONSTRAINT "Reconciliation_amount_positive" CHECK ("amount" > 0);

-- I3/I5: exactly one target per reconciliation.
-- invoiceId is excluded: card invoice is Phase 3 (CreditCardInvoice model does not exist yet).
ALTER TABLE "reconciliations"
  ADD CONSTRAINT "Reconciliation_one_target" CHECK (
    ( ("paymentId"         IS NOT NULL)::int
    + ("cardReceivableId"  IS NOT NULL)::int
    + ("expenseId"         IS NOT NULL)::int
    + ("otherIncomeId"     IS NOT NULL)::int
    + ("cashMovementId"    IS NOT NULL)::int
    + ("pairTransactionId" IS NOT NULL)::int ) = 1
  );

-- A bank transaction cannot have zero amount (it could never be reconciled: abs(amount) = 0).
ALTER TABLE "bank_transactions"
  ADD CONSTRAINT "BankTransaction_amount_nonzero" CHECK ("amount" <> 0);
