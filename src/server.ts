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

