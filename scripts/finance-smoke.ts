/**
 * [F0.2c] Smoke read-only das rotas legadas após o threading de companyId.
 *
 * Uso: npx tsx scripts/finance-smoke.ts
 * Faz login real (grava refresh_token e last_login) e consulta:
 *   GET /api/v1/payments
 *   GET /api/v1/expenses
 *   GET /api/v1/reports/dashboard
 *
 * Não cria/edita/exclui registros de domínio.
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../src/app';

async function main(): Promise<void> {
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@salao.com', password: 'admin123' });

  if (login.status !== 200) {
    throw new Error(`Login falhou (${login.status}): ${JSON.stringify(login.body)}`);
  }

  const token = login.body?.data?.accessToken;
  if (!token) throw new Error('accessToken ausente');

  const routes = [
    '/api/v1/payments',
    '/api/v1/expenses',
    '/api/v1/reports/dashboard',
    '/api/v1/reports/financial/revenue',
  ];
  let failed = false;

  for (const route of routes) {
    const res = await request(app)
      .get(route)
      .query({ startDate: '2026-01-01', endDate: new Date().toISOString().slice(0, 10) })
      .set('Authorization', `Bearer ${token}`);

    const body = res.body?.data;
    const size = Array.isArray(body) ? `${body.length} itens` : body ? 'objeto' : 'vazio';
    console.log(`[smoke] ${route} -> ${res.status} (${size})`);

    if (res.status !== 200) {
      failed = true;
      console.error(`[smoke] corpo: ${JSON.stringify(res.body).slice(0, 300)}`);
    }
  }

  if (failed) process.exit(1);
  console.log('[smoke] OK: rotas legadas respondem 200 com companyId do usuário.');
}

main().catch((err) => {
  console.error('[smoke] FALHA:', err.message);
  process.exit(1);
});
