/**
 * [F0.2d] Harness de testes de integração — cross-platform (Node puro).
 *
 * Uso:
 *   node scripts/run-integration-tests.mjs          # sobe o DB, roda, mantém container
 *   node scripts/run-integration-tests.mjs --down   # derruba o container no fim
 *
 * DATABASE_URL é injetada apenas nos processos filhos; a .env de produção
 * nunca é sobrescrita.
 */
import { spawnSync } from 'node:child_process';

const TEST_DB_URL =
  'postgresql://salao:salao_test@localhost:55432/salao_test?sslmode=disable';
const env = { ...process.env, DATABASE_URL: TEST_DB_URL, NODE_ENV: 'test' };

function run(command, args, label) {
  console.log(`[harness] ${label}: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });
  if (result.error) {
    console.error(`[harness] ${label} falhou ao iniciar:`, result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function compose() {
  const file = 'docker-compose.test.yml';
  let status = run('docker', ['compose', '-f', file, 'up', '-d', '--wait'], 'subir test-db');
  if (status !== 0) {
    console.warn('[harness] `docker compose` falhou; tentando `docker-compose`.');
    status = run('docker-compose', ['-f', file, 'up', '-d', '--wait'], 'subir test-db (fallback)');
  }
  return status;
}

let exitCode = 1;
try {
  exitCode = compose();
  if (exitCode === 0) {
    exitCode = run('npx', ['prisma', 'migrate', 'deploy'], 'migrations');
  }
  if (exitCode === 0) {
    exitCode = run(
      'npx',
      // [F2.0] --forceExit: com Redis no ar, o BullMQ mantem handle aberto e
      // o Jest nao encerra (suite verde, processo travado). Ver AUDIT 17.4.
      ['jest', '--config', 'jest.integration.config.js', '--runInBand', '--forceExit'],
      'jest integração'
    );
  }
} finally {
  if (process.argv.includes('--down')) {
    run('docker', ['compose', '-f', 'docker-compose.test.yml', 'down'], 'derrubar test-db');
  }
}

console.log(`[harness] exit=${exitCode}`);
process.exit(exitCode);
