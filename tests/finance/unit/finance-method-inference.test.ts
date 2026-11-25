/**
 * [F2.1] Inferência de método — spec §7.3 (FINANCEIRO_IMPLEMENTACAO.md:1283-1295).
 * Ordem das regras é fixa: a primeira que casar vence.
 */
import { inferMethod } from '../../../src/domain/finance/method-inference';

describe('finance method inference (F2.1)', () => {
  it('detecta PIX, TED e DOC', () => {
    expect(inferMethod('PIX RECEBIDO JOAO')).toBe('PIX');
    expect(inferMethod('TED ENVIADO EMPRESA')).toBe('TED');
    expect(inferMethod('DOC RECEBIDO')).toBe('DOC');
  });

  it('detecta BOLETO pelas variantes da spec', () => {
    expect(inferMethod('BOLETO')).toBe('BOLETO');
    expect(inferMethod('PAGTO TITULO 123456')).toBe('BOLETO');
    expect(inferMethod('COBRANCA CONTA')).toBe('BOLETO');
    expect(inferMethod('TIT 001')).toBe('BOLETO');
  });

  it('detecta FEE pelas variantes da spec', () => {
    expect(inferMethod('TARIFA MENSAL')).toBe('FEE');
    expect(inferMethod('TAR MANUTENCAO')).toBe('FEE');
    expect(inferMethod('PACOTE SERVICOS')).toBe('FEE');
    expect(inferMethod('IOF CREDITO')).toBe('FEE');
    expect(inferMethod('ANUIDADE CARTAO')).toBe('FEE');
  });

  it('detecta INTEREST', () => {
    expect(inferMethod('JUROS EMPRESTIMO')).toBe('INTEREST');
    expect(inferMethod('ENCARGO MENSAL')).toBe('INTEREST');
    expect(inferMethod('MULTA ATRASO')).toBe('INTEREST');
  });

  it('detecta CASH_DEPOSIT apenas em entrada', () => {
    expect(inferMethod('DEPOSITO', { amountCents: 10000 })).toBe('CASH_DEPOSIT');
    expect(inferMethod('DEP DINHEIRO', { amountCents: 10000 })).toBe('CASH_DEPOSIT');
    expect(inferMethod('DEP ESPECIE', { amountCents: 10000 })).toBe('CASH_DEPOSIT');
    expect(inferMethod('DEPOSITO', { amountCents: -10000 })).toBe('OTHER');
  });

  it('detecta CARD_SETTLEMENT por keyword do adquirente, apenas em entrada', () => {
    expect(inferMethod('VISA DEBITO', { amountCents: 50000, acquirerKeywords: ['VISA'] })).toBe(
      'CARD_SETTLEMENT'
    );
    expect(inferMethod('MASTERCARD DEBITO', { amountCents: 50000, acquirerKeywords: ['MASTER'] })).toBe(
      'CARD_SETTLEMENT'
    );
    expect(inferMethod('VISA DEBITO', { amountCents: -50000, acquirerKeywords: ['VISA'] })).toBe('OTHER');
  });

  it('compara keyword do adquirente sem acento e sem caixa', () => {
    expect(
      inferMethod('casa de cafe ltda', { amountCents: 50000, acquirerKeywords: ['CASA DE CAFE'] })
    ).toBe('CARD_SETTLEMENT');
  });

  it('cai em OTHER quando nada casa', () => {
    expect(inferMethod('COMPRA GENERICA')).toBe('OTHER');
    expect(inferMethod('')).toBe('OTHER');
  });

  it('respeita a ordem das regras (a primeira que casa vence)', () => {
    expect(inferMethod('PIX TARIFA')).toBe('PIX');
    expect(inferMethod('TED DOC BOLETO')).toBe('TED');
    expect(inferMethod('TARIFA JUROS')).toBe('FEE');
  });

  it('não confunde TIT com TITULO', () => {
    expect(inferMethod('TITULO EMPRESA')).toBe('OTHER');
  });
});
