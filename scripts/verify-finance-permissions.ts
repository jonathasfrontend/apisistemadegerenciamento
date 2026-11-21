/**
 * [F0.3] Verificação via API das permissões finance.*.
 *
 * Uso: npx tsx scripts/verify-finance-permissions.ts
 * Exige token de admin@salao.com no banco apontado pela .env.
 */
import 'dotenv/config';
import request from 'supertest';
import app from '../src/app';

const EXPECTED = 18;

async function main(): Promise<void> {
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@salao.com', password: 'admin123' });
  if (login.status !== 200) throw new Error(`Login falhou (${login.status})`);
  const token = login.body.data.accessToken;
  const auth = `Bearer ${token}`;

  const all = await request(app).get('/api/v1/roles/permissions').set('Authorization', auth);
  if (all.status !== 200) throw new Error(`GET /roles/permissions -> ${all.status}`);
  const finance = all.body.data.filter((p: { module: string }) => p.module === 'finance');

  const roles = await request(app).get('/api/v1/roles').set('Authorization', auth);
  if (roles.status !== 200) throw new Error(`GET /roles -> ${roles.status}`);
  const reception = roles.body.data.find((r: { name: string }) => r.name === 'Recepção');
  if (!reception) throw new Error('Role Recepção não encontrada');

  const rp = await request(app)
    .get(`/api/v1/roles/${reception.id}/permissions`)
    .set('Authorization', auth);
  if (rp.status !== 200) throw new Error(`GET /roles/:id/permissions -> ${rp.status}`);
  const receptionFinance = rp.body.data.filter((p: { module: string }) => p.module === 'finance');

  console.log(`[verify-perms] finance.* globais=${finance.length} (esperado ${EXPECTED})`);
  console.log(
    `[verify-perms] Recepção finance.*=${receptionFinance.length}: ${receptionFinance
      .map((p: { name: string }) => p.name)
      .join(', ')}`
  );

  if (finance.length !== EXPECTED) process.exitCode = 1;
  if (receptionFinance.length !== 1 || receptionFinance[0].name !== 'finance.cash.operate') {
    process.exitCode = 1;
  }
  if (process.exitCode) throw new Error('Contagem de permissões divergente da spec');
  console.log('[verify-perms] OK');
}

main().catch((err) => {
  console.error('[verify-perms] FALHA:', err.message);
  process.exit(1);
});
