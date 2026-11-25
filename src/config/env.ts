import { config } from 'dotenv';
config();

interface EnvConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  
  // JWT
  jwtSecret: string;
  jwtAccessExpiration: string;
  jwtRefreshExpiration: string;
  
  // Redis
  redisUrl: string;
  
  // CORS
  corsOrigins: string[];
  
  // Rate Limiting
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  
  // WhatsApp
  whatsappApiUrl: string;
  whatsappAccessToken: string;
  whatsappPhoneNumberId: string;
  whatsappVerifyToken: string;
  
  // Payment Gateways
  mercadopagoAccessToken: string;
  mercadopagoPublicKey: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  pagseguroEmail: string;
  pagseguroToken: string;
  
  // Email
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  
  // Google OAuth
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  
  // Monitoring
  sentryDsn: string;
  
  // File Upload
  maxFileSize: number;
  allowedFileTypes: string[];
  
  // Finance (F2) — importação de extratos e armazenamento de arquivos
  financeMaxOfxMb: number;
  financeMaxPdfMb: number;
  /** Chave AES-256-GCM (hex 64 chars ou base64 de 32 bytes). Vazio = storage indisponível. */
  financeFileKey: string;
  financeStorageDriver: 'LOCAL' | 'S3';
  financeStorageLocalPath: string;
  financeS3Bucket: string;
  financeS3Region: string;
  financeS3Endpoint: string;
  financeS3AccessKey: string;
  financeS3SecretKey: string;
  financeImportRateLimitPerHour: number;
  
  // URLs
  frontendUrl: string;
  backendUrl: string;
}

const getEnvVar = (key: string, defaultValue?: string): string => {
  const value = process.env[key] || defaultValue;
  if (!value && !defaultValue) {
    throw new Error(`Environment variable ${key} is not defined`);
  }
  return value!;
};

const getEnvVarOptional = (key: string, defaultValue: string = ''): string => {
  return process.env[key] || defaultValue;
};

export const env: EnvConfig = {
  port: parseInt(getEnvVar('PORT', '4000'), 10),
  nodeEnv: getEnvVar('NODE_ENV', 'development'),
  databaseUrl: getEnvVar('DATABASE_URL'),
  
  // JWT
  jwtSecret: getEnvVar('JWT_SECRET'),
  jwtAccessExpiration: getEnvVar('JWT_ACCESS_EXPIRATION', '15m'),
  jwtRefreshExpiration: getEnvVar('JWT_REFRESH_EXPIRATION', '30d'),
  
  // Redis
  redisUrl: getEnvVar('REDIS_URL', 'redis://localhost:6379'),
  
  // CORS
  corsOrigins: getEnvVar('CORS_ORIGINS', 'http://localhost:3000').split(','),
  
  // Rate Limiting
  rateLimitWindowMs: parseInt(getEnvVar('RATE_LIMIT_WINDOW_MS', '900000'), 10),
  rateLimitMaxRequests: parseInt(getEnvVar('RATE_LIMIT_MAX_REQUESTS', '100'), 10),
  
  // WhatsApp
  whatsappApiUrl: getEnvVarOptional('WHATSAPP_API_URL', 'https://graph.facebook.com/v18.0'),
  whatsappAccessToken: getEnvVarOptional('WHATSAPP_ACCESS_TOKEN'),
  whatsappPhoneNumberId: getEnvVarOptional('WHATSAPP_PHONE_NUMBER_ID'),
  whatsappVerifyToken: getEnvVarOptional('WHATSAPP_VERIFY_TOKEN'),
  
  // Payment Gateways
  mercadopagoAccessToken: getEnvVarOptional('MERCADOPAGO_ACCESS_TOKEN'),
  mercadopagoPublicKey: getEnvVarOptional('MERCADOPAGO_PUBLIC_KEY'),
  stripeSecretKey: getEnvVarOptional('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: getEnvVarOptional('STRIPE_WEBHOOK_SECRET'),
  pagseguroEmail: getEnvVarOptional('PAGSEGURO_EMAIL'),
  pagseguroToken: getEnvVarOptional('PAGSEGURO_TOKEN'),
  
  // Email
  smtpHost: getEnvVarOptional('SMTP_HOST', 'smtp.gmail.com'),
  smtpPort: parseInt(getEnvVarOptional('SMTP_PORT', '587'), 10),
  smtpSecure: getEnvVarOptional('SMTP_SECURE', 'false') === 'true',
  smtpUser: getEnvVarOptional('SMTP_USER'),
  smtpPass: getEnvVarOptional('SMTP_PASS'),
  
  // Google OAuth
  googleClientId: getEnvVarOptional('GOOGLE_CLIENT_ID'),
  googleClientSecret: getEnvVarOptional('GOOGLE_CLIENT_SECRET'),
  googleRedirectUri: getEnvVarOptional('GOOGLE_REDIRECT_URI'),
  
  // Monitoring
  sentryDsn: getEnvVarOptional('SENTRY_DSN'),
  
  // File Upload
  maxFileSize: parseInt(getEnvVarOptional('MAX_FILE_SIZE', '5242880'), 10),
  allowedFileTypes: getEnvVarOptional('ALLOWED_FILE_TYPES', 'image/jpeg,image/png').split(','),
  
  // Finance (F2) — spec §7.1 (FINANCEIRO_IMPLEMENTACAO.md:1207-1218).
  // A chave e o bucket são opcionais no *boot* (a API responde 503 quando
  // faltam) — quebrar a aplicação inteira por config de finance seria pior.
  financeMaxOfxMb: parseInt(getEnvVarOptional('FINANCE_MAX_OFX_MB', '10'), 10),
  financeMaxPdfMb: parseInt(getEnvVarOptional('FINANCE_MAX_PDF_MB', '20'), 10),
  financeFileKey: getEnvVarOptional('FINANCE_FILE_KEY'),
  financeStorageDriver: (getEnvVarOptional('FINANCE_STORAGE_DRIVER', 'LOCAL').toUpperCase() === 'S3'
    ? 'S3'
    : 'LOCAL'),
  financeStorageLocalPath: getEnvVarOptional('FINANCE_STORAGE_LOCAL_PATH', './storage/finance'),
  financeS3Bucket: getEnvVarOptional('FINANCE_S3_BUCKET'),
  financeS3Region: getEnvVarOptional('FINANCE_S3_REGION', 'us-east-1'),
  financeS3Endpoint: getEnvVarOptional('FINANCE_S3_ENDPOINT'),
  financeS3AccessKey: getEnvVarOptional('FINANCE_S3_ACCESS_KEY'),
  financeS3SecretKey: getEnvVarOptional('FINANCE_S3_SECRET_KEY'),
  financeImportRateLimitPerHour: parseInt(
    getEnvVarOptional('FINANCE_IMPORT_RATE_LIMIT_PER_HOUR', '20'),
    10
  ),
  
  // URLs
  frontendUrl: getEnvVar('FRONTEND_URL', 'http://localhost:3000'),
  backendUrl: getEnvVar('BACKEND_URL', 'http://localhost:4000'),
};
