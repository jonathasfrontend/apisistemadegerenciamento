/**
 * [F2.5] Subset sum para cartão 1:N — spec §7.6.3 (FINANCEIRO_IMPLEMENTACAO.md:1394-1422).
 *
 * DFS com poda por sufixo e teto de nós. Devolve a PRIMEIRA combinação
 * encontrada — várias combinações podem somar o mesmo valor, por isso o motor
 * trata o resultado sempre como SUGGESTED, nunca AUTO.
 */
export interface SubsetItem {
  id: string;
  cents: number;
}

/**
 * Tolerância em centavos: max(1, round(T × pct / 100)). T já vem em centavos.
 * `Math.round` é HALF_UP para positivos, que é o caso (T ≥ 0).
 */
export function cardToleranceCents(targetCents: number, pct: number): number {
  return Math.max(1, Math.round(Math.abs(targetCents) * pct / 100));
}

export function findSubset(
  cands: SubsetItem[],
  target: number,
  tol: number,
  maxNodes = 200_000
): string[] | null {
  const s = [...cands].sort((a, b) => b.cents - a.cents);
  const suffix = new Array<number>(s.length + 1).fill(0);
  for (let i = s.length - 1; i >= 0; i -= 1) suffix[i] = suffix[i + 1] + s[i].cents;

  let nodes = 0;
  let best: string[] | null = null;
  const pick: string[] = [];

  const dfs = (i: number, sum: number): void => {
    if (best || nodes++ > maxNodes) return;
    if (pick.length && Math.abs(sum - target) <= tol) {
      best = [...pick];
      return;
    }
    if (i >= s.length || sum > target + tol || sum + suffix[i] < target - tol) return;
    pick.push(s[i].id);
    dfs(i + 1, sum + s[i].cents);
    pick.pop();
    dfs(i + 1, sum);
  };

  dfs(0, 0);
  return best;
}
