/**
 * [F2.1] Dedupe de linhas — spec §7.3 (FINANCEIRO_IMPLEMENTACAO.md:1297-1313) e
 * Review Focus #2 do plano F2 (FITID repetido/vazio/"0" é comum).
 *
 * F:<FITID> só quando o FITID é confiável (presente em todas as linhas e único
 * no arquivo); caso contrário H:<sha256 da tripla + ocorrência>.
 */
import { computeDedupeKeys } from '../../../src/domain/finance/dedupe';

describe('finance dedupe (F2.1)', () => {
  it('usa F: quando todos os FITIDs são únicos', () => {
    const keys = computeDedupeKeys([
      { postedAt: '2026-11-18', cents: -1050, description: 'Padaria', externalId: 'A1' },
      { postedAt: '2026-11-20', cents: 150000, description: 'Cliente', externalId: 'A2' },
    ]);
    expect(keys).toEqual(['F:A1', 'F:A2']);
  });

  it('cai para H: quando há FITID repetido', () => {
    const keys = computeDedupeKeys([
      { postedAt: '2026-11-18', cents: -1050, description: 'Padaria', externalId: 'A1' },
      { postedAt: '2026-11-19', cents: -2000, description: 'Padaria', externalId: 'A1' },
    ]);
    expect(keys.every((k) => k.startsWith('H:'))).toBe(true);
    expect(new Set(keys).size).toBe(2);
  });

  it('cai para H: quando falta FITID em alguma linha', () => {
    const keys = computeDedupeKeys([
      { postedAt: '2026-11-18', cents: -1050, description: 'Padaria', externalId: 'A1' },
      { postedAt: '2026-11-19', cents: -2000, description: 'Padaria', externalId: null },
    ]);
    expect(keys.every((k) => k.startsWith('H:'))).toBe(true);
  });

  it('trata FITID "0" como não confiável', () => {
    const keys = computeDedupeKeys([
      { postedAt: '2026-11-18', cents: -1050, description: 'Padaria', externalId: '0' },
    ]);
    expect(keys[0].startsWith('H:')).toBe(true);
  });

  it('gera chaves diferentes para linhas idênticas (ocorrência n)', () => {
    const rows = [
      { postedAt: '2026-11-18', cents: -1050, description: 'Padaria São José' },
      { postedAt: '2026-11-18', cents: -1050, description: 'Padaria São José' },
    ];
    const keys = computeDedupeKeys(rows);
    expect(keys[0]).not.toBe(keys[1]);
    expect(new Set(keys).size).toBe(2);
  });

  it('a chave H: é determinística', () => {
    const rows = [{ postedAt: '2026-11-18', cents: -1050, description: 'Padaria São José' }];
    expect(computeDedupeKeys(rows)).toEqual(computeDedupeKeys(rows));
  });

  it('a chave H: tem formato H: + sha256 hexadecimal', () => {
    const keys = computeDedupeKeys([
      { postedAt: '2026-11-18', cents: -1050, description: 'Padaria' },
    ]);
    expect(keys[0]).toMatch(/^H:[0-9a-f]{64}$/);
  });

  it('descrições equivalentes (mesma normalização) geram a mesma base', () => {
    const rows = [
      { postedAt: '2026-11-18', cents: -1050, description: 'Padaria São José' },
      { postedAt: '2026-11-18', cents: -1050, description: 'PADARIA SAO JOSE' },
    ];
    const keys = computeDedupeKeys(rows);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('valores diferentes geram chaves diferentes', () => {
    const rows = [
      { postedAt: '2026-11-18', cents: -1050, description: 'Padaria' },
      { postedAt: '2026-11-18', cents: -1051, description: 'Padaria' },
    ];
    const keys = computeDedupeKeys(rows);
    expect(keys[0]).not.toBe(keys[1]);
  });
});
