/**
 * [F1.1b — correção de review] Guard de destino para escritas financeiras.
 *
 * O `.env` do backend aponta para o Neon. Sem este guard, um `npm run
 * seed:finance` displicente gravaria em produção. Regra fail-closed:
 *
 * - host local (localhost/127.0.0.1/::1): execução livre;
 * - qualquer outro host: exige `--allow-non-local-db` E `--company-ids=<csv>`.
 *
 * `NODE_ENV=test` NÃO libera um host remoto — só o host decide. A função é
 * pura e não conecta em banco, para poder ser testada sem DATABASE_URL real.
 */

export const NON_LOCAL_CONFIRM_FLAG = '--allow-non-local-db';
export const COMPANY_IDS_FLAG = '--company-ids';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export interface FinanceWriteTargetOptions {
  databaseUrl?: string;
  nodeEnv?: string;
  argv?: string[];
  command: string;
  /** Padrão true. Só é exigido quando o host é remoto. */
  requireCompanyIds?: boolean;
}

export interface FinanceWriteTarget {
  hostname: string;
  remote: boolean;
  companyIds?: string[];
}

/** Parse de `--company-ids=a,b,a` → `['a','b']`. Nunca retorna lista vazia. */
export function parseCompanyIdsArg(argv: string[]): string[] | undefined {
  const arg = argv.find((value) => value.startsWith(`${COMPANY_IDS_FLAG}=`));
  if (!arg) return undefined;

  const ids = arg
    .slice(COMPANY_IDS_FLAG.length + 1)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!ids.length) {
    throw new Error(`[${COMPANY_IDS_FLAG}] informe ao menos um companyId.`);
  }

  return [...new Set(ids)];
}

export function resolveFinanceWriteTarget(
  options: FinanceWriteTargetOptions
): FinanceWriteTarget {
  const raw = options.databaseUrl ?? '';
  if (!raw) {
    throw new Error('[destino] DATABASE_URL não definida — nenhuma escrita foi feita.');
  }

  let hostname: string;
  try {
    hostname = new URL(raw).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    throw new Error('[destino] DATABASE_URL inválida — nenhuma escrita foi feita.');
  }
  if (!hostname) {
    throw new Error('[destino] DATABASE_URL sem host — nenhuma escrita foi feita.');
  }

  const argv = options.argv ?? [];
  const remote = !LOCAL_HOSTS.has(hostname);
  const companyIds = parseCompanyIdsArg(argv);

  if (
    remote &&
    !argv.includes(NON_LOCAL_CONFIRM_FLAG)
  ) {
    throw new Error(
      `[${options.command}] destino remoto bloqueado (host=${hostname}). ` +
        `Reexecutar com ${NON_LOCAL_CONFIRM_FLAG} e ${COMPANY_IDS_FLAG}=<ids> ` +
        'somente com autorização explícita. Nenhuma escrita foi feita.'
    );
  }

  if (remote && (options.requireCompanyIds ?? true) && !companyIds) {
    throw new Error(
      `[${options.command}] destino remoto exige ${COMPANY_IDS_FLAG}=<ids>. ` +
        'Nenhuma escrita foi feita.'
    );
  }

  return { hostname, remote, companyIds };
}
