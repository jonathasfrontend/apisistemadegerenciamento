-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'IN_APP';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'NO_SHOW';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "read_at" TIMESTAMP(3),
ADD COLUMN     "user_id" TEXT;

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
