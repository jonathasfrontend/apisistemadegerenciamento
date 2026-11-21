-- 0B.1 — Multiempresa integral: companyId em 13 tabelas de negócio,
-- backfill para a empresa ativa mais antiga, uniques compostos e índices.
--
-- SEGURANÇA:
--   * NENHUM DROP TABLE / DROP COLUMN. Somente ADD COLUMN, UPDATE, SET NOT NULL,
--     troca de índices UNIQUE e criação de FKs/índices.
--   * O backfill usa a empresa ativa mais antiga (a "Empresa padrão"). Em
--     2026-11-21 o Neon tem exatamente uma empresa ativa:
--     20309d0c-0a23-4ff5-b5c9-c43568e94018 ("Empresa padrão").
--     A resolução é dinâmica para a migration também funcionar no DB de teste,
--     cujos IDs são diferentes. Se não houver empresa ativa, a migration ABORTA
--     em vez de gravar NULL/órfão.
--   * Ordem obrigatória: ADD COLUMN nullable -> UPDATE -> SET NOT NULL ->
--     CREATE INDEX/UNIQUE -> ADD FK. Nada de NOT NULL antes do backfill.

-- ============================================================
-- PASSO 1 — remover os 4 UNIQUE globais (substituídos por compostos no passo 4)
-- ============================================================
DROP INDEX "clients_cpf_key";
DROP INDEX "clients_phone_key";
DROP INDEX "products_sku_key";
DROP INDEX "users_email_key";

-- ============================================================
-- PASSO 2 — ADD COLUMN nullable nas 13 tabelas de negócio
-- ============================================================
ALTER TABLE "appointments" ADD COLUMN "companyId" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "companyId" TEXT;
ALTER TABLE "clients" ADD COLUMN "companyId" TEXT;
ALTER TABLE "commissions" ADD COLUMN "companyId" TEXT;
ALTER TABLE "notifications" ADD COLUMN "companyId" TEXT;
ALTER TABLE "products" ADD COLUMN "companyId" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "companyId" TEXT;
ALTER TABLE "reviews" ADD COLUMN "companyId" TEXT;
ALTER TABLE "sale_items" ADD COLUMN "companyId" TEXT;
ALTER TABLE "services" ADD COLUMN "companyId" TEXT;
ALTER TABLE "staff" ADD COLUMN "companyId" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "companyId" TEXT;
ALTER TABLE "waitlist" ADD COLUMN "companyId" TEXT;

-- ============================================================
-- PASSO 3 — BACKFILL atômico para a empresa ativa mais antiga
-- ============================================================
DO $$
DECLARE
  default_company_id TEXT;
BEGIN
  SELECT "id" INTO default_company_id
  FROM "companies"
  WHERE "isActive" = true
  ORDER BY "createdAt" ASC
  LIMIT 1;

  IF default_company_id IS NULL THEN
    RAISE EXCEPTION 'Backfill 0B.1 abortado: nenhuma empresa ativa encontrada';
  END IF;

  UPDATE "appointments"    SET "companyId" = default_company_id WHERE "companyId" IS NULL;
  UPDATE "audit_logs"      SET "companyId" = default_company_id WHERE "companyId" IS NULL;
  UPDATE "clients"         SET "companyId" = default_company_id WHERE "companyId" IS NULL;
  UPDATE "commissions"     SET "companyId" = default_company_id WHERE "companyId" IS NULL;
  UPDATE "notifications"   SET "companyId" = default_company_id WHERE "companyId" IS NULL;
  UPDATE "products"        SET "companyId" = default_company_id WHERE "companyId" IS NULL;
  UPDATE "refresh_tokens"  SET "companyId" = default_company_id WHERE "companyId" IS NULL;
  UPDATE "reviews"         SET "companyId" = default_company_id WHERE "companyId" IS NULL;
  UPDATE "sale_items"      SET "companyId" = default_company_id WHERE "companyId" IS NULL;
  UPDATE "services"        SET "companyId" = default_company_id WHERE "companyId" IS NULL;
  UPDATE "staff"           SET "companyId" = default_company_id WHERE "companyId" IS NULL;
  UPDATE "stock_movements" SET "companyId" = default_company_id WHERE "companyId" IS NULL;
  UPDATE "waitlist"        SET "companyId" = default_company_id WHERE "companyId" IS NULL;
END $$;

-- ============================================================
-- PASSO 4 — SET NOT NULL (só depois do backfill)
-- ============================================================
ALTER TABLE "appointments" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "clients" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "commissions" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "notifications" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "products" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "refresh_tokens" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "reviews" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "sale_items" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "services" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "staff" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "stock_movements" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "waitlist" ALTER COLUMN "companyId" SET NOT NULL;

-- ============================================================
-- PASSO 5 — UNIQUE compostos (D-0B.3) + índices
-- ============================================================
CREATE UNIQUE INDEX "clients_companyId_phone_key" ON "clients"("companyId", "phone");
CREATE UNIQUE INDEX "clients_companyId_cpf_key" ON "clients"("companyId", "cpf");
CREATE UNIQUE INDEX "products_companyId_sku_key" ON "products"("companyId", "sku");
CREATE UNIQUE INDEX "users_companyId_email_key" ON "users"("companyId", "email");

CREATE INDEX "appointments_companyId_idx" ON "appointments"("companyId");
CREATE INDEX "appointments_companyId_created_at_idx" ON "appointments"("companyId", "created_at");
CREATE INDEX "audit_logs_companyId_idx" ON "audit_logs"("companyId");
CREATE INDEX "audit_logs_companyId_created_at_idx" ON "audit_logs"("companyId", "created_at");
CREATE INDEX "clients_companyId_idx" ON "clients"("companyId");
CREATE INDEX "commissions_companyId_idx" ON "commissions"("companyId");
CREATE INDEX "notifications_companyId_idx" ON "notifications"("companyId");
CREATE INDEX "notifications_companyId_created_at_idx" ON "notifications"("companyId", "created_at");
CREATE INDEX "products_companyId_idx" ON "products"("companyId");
CREATE INDEX "refresh_tokens_companyId_idx" ON "refresh_tokens"("companyId");
CREATE INDEX "reviews_companyId_idx" ON "reviews"("companyId");
CREATE INDEX "sale_items_companyId_idx" ON "sale_items"("companyId");
CREATE INDEX "services_companyId_idx" ON "services"("companyId");
CREATE INDEX "staff_companyId_idx" ON "staff"("companyId");
CREATE INDEX "stock_movements_companyId_idx" ON "stock_movements"("companyId");
CREATE INDEX "waitlist_companyId_idx" ON "waitlist"("companyId");

-- ============================================================
-- PASSO 6 — FOREIGN KEYS para companies
-- ============================================================
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff" ADD CONSTRAINT "staff_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clients" ADD CONSTRAINT "clients_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "services" ADD CONSTRAINT "services_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waitlist" ADD CONSTRAINT "waitlist_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
