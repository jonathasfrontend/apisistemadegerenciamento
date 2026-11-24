// F0.2d: suite de integração — banco de teste isolado, execução serial.
// Nome do arquivo segue o declarado em `Files` do plano Fase 0 (o passo 4
// do plano cita `jest.config.integration.js`; prevalece este nome).
const base = require('./jest.config');

module.exports = {
  ...base,
  roots: ['<rootDir>/tests'],
  testMatch: ['**/tests/finance/integration/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  maxWorkers: 1,
  // [F2.0] Aborta a suite se o DATABASE_URL efetivo nao for o banco local
  // de teste (protege contra o dotenv apontar para o .env/Neon).
  setupFiles: ['<rootDir>/tests/finance/integration/setup.db-guard.ts'],
};
