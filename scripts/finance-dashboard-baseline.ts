/**
 * [F0.2c] Baseline de /reports/dashboard para provar ausencia de regressao
 * numerica antes/depois do threading de companyId.
 *
 * Uso: npx tsx scripts/finance-dashboard-baseline.ts before|after
 * Saida: ../docs/finance/audit/dashboard-baseline-<label>.json
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import app from '../src/app';

const label = process.argv[2];
if (!label || !['before', 'after'].includes(label)) {
  console.error('Uso: npx tsx scripts/finance-dashboard-baseline.ts before|after');
  process.exit(1);
}

const startDate = '2026-01-01';
const endDate = new Date().toISOString().slice(0, 10);
const outDir = path.resolve(__dirname, '../../docs/finance/audit');
const outFile = path.join(outDir, `dashboard-baseline-${label}.json`);

async function main(): Promise<void> {
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@salao.com', password: 'admin123' });

  if (login.status !== 200) {
    throw new Error(`Login falhou (${login.status}): ${JSON.stringify(login.body)}`);
  }

  const token = login.body?.data?.accessToken;
  if (!token) {
    throw new Error(`accessToken ausente na resposta: ${JSON.stringify(login.body)}`);
  }

  const res = await request(app)
    .get('/api/v1/reports/dashboard')
    .query({ startDate, endDate })
    .set('Authorization', `Bearer ${token}`);

  if (res.status !== 200) {
    throw new Error(`Dashboard falhou (${res.status}): ${JSON.stringify(res.body)}`);
  }

  const payload = {
    label,
    period: { startDate, endDate },
    status: res.status,
    body: res.body,
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  console.log(`[baseline] ${label} gravado em ${outFile}`);
  console.log(`[baseline] periodo ${startDate} .. ${endDate} | status ${res.status}`);
  console.log(`[baseline] body: ${JSON.stringify(res.body).slice(0, 300)}`);
}

main().catch((err) => {
  console.error('[baseline] FALHA:', err.message);
  process.exit(1);
});
