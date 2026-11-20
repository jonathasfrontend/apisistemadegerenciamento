-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" TEXT;

-- Dedupe por (usuário, evento): 1 registro por destinatário por evento,
-- mesmo com corrida entre o worker BullMQ e o reconciliador.
CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");
