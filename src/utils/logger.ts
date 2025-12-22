import winston from 'winston';
import { env } from '../config/env';

const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue',
};

winston.addColors(logColors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
);

// Configurar transportes baseado no ambiente
// Em produção (Vercel), usar apenas Console
// Em desenvolvimento, usar Console + File
const transports: winston.transport[] = [
  new winston.transports.Console(),
];

// Adicionar file transports apenas em ambiente local (não serverless)
if (env.nodeEnv === 'development' || process.env.VERCEL !== '1') {
  try {
    const fs = require('fs');
    const path = require('path');
    const logsDir = path.join(process.cwd(), 'logs');
    
    // Criar diretório de logs se não existir
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    transports.push(
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
      }),
      new winston.transports.File({ filename: 'logs/all.log' })
    );
  } catch (error) {
    // Se não conseguir criar logs em arquivo, apenas usar console
    console.warn('Não foi possível configurar file logging, usando apenas console');
  }
}

export const logger = winston.createLogger({
  level: env.nodeEnv === 'development' ? 'debug' : 'warn',
  levels: logLevels,
  format,
  transports,
});
