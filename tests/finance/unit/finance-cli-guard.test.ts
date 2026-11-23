/**
 * [F1.1b — correção de review] Guard de destino para os scripts financeiros.
 *
 * O .env do backend aponta para o Neon. Sem guard, `npm run seed:finance`
 * gravaria em produção. Estes testes fixam o fail-closed: host remoto só com
 * flag explícita E company-ids obrigatório, mesmo com NODE_ENV=test.
 */
import {
  resolveFinanceWriteTarget,
  NON_LOCAL_CONFIRM_FLAG,
} from '../../../scripts/finance-cli-guard';

const REMOTE = 'postgresql://user:secret@ep-fancy-cherry.example.neon.tech/salao';
const LOCAL = 'postgresql://salao:salao_test@localhost:55432/salao_test?sslmode=disable';

describe('finance write target guard (finance F1.1b)', () => {
  it('allows localhost and 127.0.0.1 without any flag', () => {
    expect(resolveFinanceWriteTarget({ databaseUrl: LOCAL, command: 'seed' })).toEqual({
      hostname: 'localhost',
      remote: false,
      companyIds: undefined,
    });
    expect(
      resolveFinanceWriteTarget({
        databaseUrl: 'postgresql://u:p@127.0.0.1:55432/db',
        command: 'migrate',
        requireCompanyIds: true,
      }).remote
    ).toBe(false);
  });

  it('blocks a remote host when the explicit flag is absent', () => {
    expect(() =>
      resolveFinanceWriteTarget({ databaseUrl: REMOTE, command: 'seed' })
    ).toThrow(/ep-fancy-cherry\.example\.neon\.tech/);
    expect(() =>
      resolveFinanceWriteTarget({ databaseUrl: REMOTE, command: 'seed' })
    ).toThrow(new RegExp(NON_LOCAL_CONFIRM_FLAG.replace(/[-]/g, '\\-')));
  });

  it('stays fail-closed with NODE_ENV=test on a remote host', () => {
    expect(() =>
      resolveFinanceWriteTarget({
        databaseUrl: REMOTE,
        command: 'seed',
        nodeEnv: 'test',
      })
    ).toThrow(/bloqueado/);
  });

  it('requires --company-ids even when the remote flag is present', () => {
    expect(() =>
      resolveFinanceWriteTarget({
        databaseUrl: REMOTE,
        command: 'migrate',
        argv: ['node', 'script', NON_LOCAL_CONFIRM_FLAG],
      })
    ).toThrow(/--company-ids/);
  });

  it('accepts a remote target only with flag plus a deduplicated company-ids list', () => {
    const target = resolveFinanceWriteTarget({
      databaseUrl: REMOTE,
      command: 'seed',
      argv: ['node', 'script', NON_LOCAL_CONFIRM_FLAG, '--company-ids=a,b,a'],
    });

    expect(target.remote).toBe(true);
    expect(target.companyIds).toEqual(['a', 'b']);
  });

  it('rejects an empty --company-ids value and an invalid DATABASE_URL', () => {
    expect(() =>
      resolveFinanceWriteTarget({
        databaseUrl: REMOTE,
        command: 'seed',
        argv: [NON_LOCAL_CONFIRM_FLAG, '--company-ids='],
      })
    ).toThrow(/--company-ids/);

    expect(() =>
      resolveFinanceWriteTarget({ databaseUrl: 'not-a-url', command: 'seed' })
    ).toThrow(/DATABASE_URL/);
  });
});
