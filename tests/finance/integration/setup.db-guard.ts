/**
 * [F2.0] Guard de banco para a suite de integracao.
 *
 * Incident (2026-11-24): rodar `npx jest --config jest.integration.config.js`
 * FORA do harness fez o dotenv ler `backend/.env` (Neon) e a suite semeou
 * tenants de teste em producao. 62 companies + 27 roles + 552 categorias
 * ficaram no Neon ate a limpeza.
 *
 * Este arquivo roda como `setupFiles`: antes de qualquer teste importar a
 * aplicacao (e portanto antes do `dotenv.config()`), ele verifica o
 * `DATABASE_URL` efetivo. Se nao for o banco local de teste, aborta.
 *
 * Regra: host local (localhost/127.0.0.1) E nome do banco contendo "test".
 * Qualquer host remoto (neon.tech, supabase.co, etc.) => ABORT.
 */
const url = process.env.DATABASE_URL;

const isLocalHost =
  !!url && /@(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(url);
const isTestDatabase = !!url && /\/[^/?]*test[^/?]*(\?|$)/.test(url);

if (!url) {
  throw new Error(
    '[integration-guard] DATABASE_URL ausente. Rode via `npm run test:integration` ' +
      '(o harness injeta o banco de teste). Sem isso, o dotenv leria backend/.env ' +
      'e a suite escreveria em producao.'
  );
}

if (!isLocalHost || !isTestDatabase) {
  throw new Error(
    `[integration-guard] DATABASE_URL nao aponta para o banco local de teste: ${url}\n` +
      'Abortando para nao semear dados em ambiente remoto. ' +
      'Use `npm run test:integration`.'
  );
}

// eslint-disable-next-line no-console
console.log(`[integration-guard] banco de teste OK: ${url.replace(/:[^:@/]*@/, ':***@')}`);
