/**
 * [F2.1] Parser OFX — spec §7.2 (FINANCEIRO_IMPLEMENTACAO.md:1220-1277).
 *
 * Fixtures (tests/finance/fixtures/ofx):
 *  - bank-sgml-latin1.ofx: SGML sem tag de fechamento, acentos (bytes win1252),
 *    vírgula decimal, DTPOSTED com fuso.
 *  - bank-xml-utf8.ofx: XML bem formado, UTF-8.
 *  - card-sgml.ofx: <CCSTMTRS> (cartão), sem </STMTTRN>.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { decodeOfx } from '../../../src/domain/finance/parsers/ofx/decode';
import { parseOfx } from '../../../src/domain/finance/parsers/ofx/parse';

const FIXTURES = join(__dirname, '../fixtures/ofx');

const readUtf8 = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
/** O fixture latin1 é lido como UTF-8 e re-codificado em win1252 para gerar os bytes reais. */
const readWin1252 = (name: string) => iconv.encode(readUtf8(name), 'win1252');

describe('OFX decode (F2.1)', () => {
  it('decodifica win1252 preservando acentos', () => {
    const text = decodeOfx(readWin1252('bank-sgml-latin1.ofx'));
    expect(text).toContain('Padaria São José');
  });

  it('decodifica UTF-8 quando o cabeçalho anuncia', () => {
    const text = decodeOfx(Buffer.from(readUtf8('bank-xml-utf8.ofx'), 'utf8'));
    expect(text).toContain('<OFX>');
    expect(text).toContain('CLIENTE LTDA');
  });
});

describe('OFX parse (F2.1)', () => {
  describe('SGML win1252 (banco)', () => {
    const result = parseOfx(decodeOfx(readWin1252('bank-sgml-latin1.ofx')));

    it('identifica extrato bancário', () => {
      expect(result.kind).toBe('BANK');
    });

    it('lê conta, banco e período', () => {
      expect(result.bankId).toBe('341');
      expect(result.accountId).toBe('12345-6');
      expect(result.start).toBe('2026-11-01');
      expect(result.end).toBe('2026-11-30');
    });

    it('lê as 3 transações com data e valor', () => {
      expect(result.txs).toHaveLength(3);
      expect(result.txs[0].posted).toBe('2026-11-18');
      expect(result.txs[0].cents).toBe(-1050);
      expect(result.txs[1].posted).toBe('2026-11-20');
      expect(result.txs[1].cents).toBe(150000);
      expect(result.txs[2].posted).toBe('2026-11-18');
      expect(result.txs[2].cents).toBe(-1050);
    });

    it('lê o FITID', () => {
      expect(result.txs.map((t) => t.fitid)).toEqual(['FIT-0001', 'FIT-0002', 'FIT-0003']);
    });

    it('lê o saldo final (LEDGERBAL)', () => {
      expect(result.ledgerCents).toBe(148950);
      expect(result.ledgerDate).toBe('2026-11-30');
    });

    it('compõe a descrição sem duplicar MEMO contido no NAME', () => {
      expect(result.txs[0].description).toBe('Padaria São José');
      expect(result.txs[1].description).toBe('PIX RECEBIDO CLIENTE 01');
    });
  });

  describe('XML UTF-8 (banco)', () => {
    const result = parseOfx(decodeOfx(Buffer.from(readUtf8('bank-xml-utf8.ofx'), 'utf8')));

    it('lê as 2 transações', () => {
      expect(result.kind).toBe('BANK');
      expect(result.txs).toHaveLength(2);
      expect(result.txs[0].cents).toBe(25075);
      expect(result.txs[1].cents).toBe(-8990);
      expect(result.txs[0].posted).toBe('2026-11-01');
    });

    it('lê o saldo final', () => {
      expect(result.ledgerCents).toBe(16085);
    });

    it('compõe a descrição sem duplicar NAME contido no MEMO', () => {
      expect(result.txs[0].description).toBe('PIX RECEBIDO CLIENTE LTDA');
      expect(result.txs[1].description).toBe('SHELL COMBUSTIVEIS');
    });
  });

  describe('cartão (CCSTMTRS)', () => {
    const result = parseOfx(decodeOfx(Buffer.from(readUtf8('card-sgml.ofx'), 'utf8')));

    it('identifica cartão de crédito', () => {
      expect(result.kind).toBe('CARD');
    });

    it('lê as transações sem </STMTTRN>', () => {
      expect(result.txs).toHaveLength(2);
      expect(result.txs[0].cents).toBe(-4990);
      expect(result.txs[1].cents).toBe(-4990);
    });

    it('aceita FITID ausente em uma linha', () => {
      expect(result.txs[0].fitid).toBeUndefined();
      expect(result.txs[1].fitid).toBe('CC-1');
    });

    it('lê o saldo final', () => {
      expect(result.ledgerCents).toBe(-9980);
    });
  });
});
