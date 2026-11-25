import app from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import prisma from './config/db';

// Para Vercel, exportar o app diretamente
export default app;

// Função para iniciar o servidor (apenas para ambiente local)
const startServer = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('✓ Database connected successfully');

    // Fila de notificações (BullMQ) + reconciliador de horário.
    // Import dinâmico + try/catch: Redis fora do ar NÃO pode derrubar a API.
    let notificationWorker: { close: () => Promise<void> } | undefined;
    let financeRecurringWorker: { close: () => Promise<void> } | undefined;
    let financeOverdueWorker: { close: () => Promise<void> } | undefined;
    let financeImportWorker: { close: () => Promise<void> } | undefined;
    try {
      const { notificationWorker: worker } = await import('./jobs/notification.worker');
      const { startAppointmentStartReconciler } = await import('./jobs/appointment-start');
      notificationWorker = worker;
      startAppointmentStartReconciler();
      logger.info('✓ Reconciliador de agendamento iniciado');
    } catch (error: any) {
      logger.warn('Fila de notificações indisponível (Redis):', error?.message);
    }

    try {
      const { startFinanceRecurringWorker } = await import('./jobs/finance-recurring');
      financeRecurringWorker = startFinanceRecurringWorker();
      logger.info('✓ Job de recorrência financeira iniciado');
    } catch (error: any) {
      logger.warn('Job de recorrência financeira indisponível (Redis):', error?.message);
    }

    try {
      const { startFinanceOverdueWorker } = await import('./jobs/finance-overdue');
      financeOverdueWorker = startFinanceOverdueWorker();
      logger.info('✓ Job de alerta de vencimento financeiro iniciado');
    } catch (error: any) {
      logger.warn('Job de alerta de vencimento financeiro indisponível (Redis):', error?.message);
    }

    try {
      const { startFinanceImportWorker } = await import('./jobs/finance-import');
      financeImportWorker = startFinanceImportWorker();
      logger.info('✓ Worker de importação financeira iniciado');
    } catch (error: any) {
      logger.warn('Worker de importação financeira indisponível (Redis):', error?.message);
    }

    // Start server
    const server = app.listen(env.port, () => {
      logger.info(`🚀 Server running on port ${env.port}`);
      logger.info(`📊 Environment: ${env.nodeEnv}`);
      logger.info(`🔗 Health check: http://localhost:${env.port}/health`);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);

      server.close(async () => {
        logger.info('HTTP server closed');

        if (notificationWorker) {
          await notificationWorker.close().catch(() => undefined);
          logger.info('Notification worker closed');
        }
        if (financeRecurringWorker) {
          await financeRecurringWorker.close().catch(() => undefined);
          logger.info('Finance recurring worker closed');
        }
        if (financeOverdueWorker) {
          await financeOverdueWorker.close().catch(() => undefined);
          logger.info('Finance overdue worker closed');
        }
        if (financeImportWorker) {
          await financeImportWorker.close().catch(() => undefined);
          logger.info('Finance import worker closed');
        }

        await prisma.$disconnect();
        logger.info('Database disconnected');
        
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forcing shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Apenas iniciar o servidor se não estiver no ambiente Vercel
if (process.env.VERCEL !== '1') {
  startServer();
}

