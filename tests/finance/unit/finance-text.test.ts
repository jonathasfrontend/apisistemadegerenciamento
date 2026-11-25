/**
 * [F2.1] Normalização de descrição — spec §7.3 (FINANCEIRO_IMPLEMENTACAO.md:1281).
 *
 * Dois níveis:
 *  - normalizeText: maiúsculas → sem acentos → pontuação→espaço → colapsa.
 *    Usado para inferência de método (mantém keywords como PIX/TIT/PAGTO).
 *  - normalizeDescription: normalizeText + remoção de ruído (PIX, RECEBIDO,
 *    ENVIADO, TRANSF, TRANSFERENCIA, COMPRA, DEB, CRED, PAGTO, datas e
 *    sequências com mais de 6 dígitos). Usado só para comparação/dedupe.
 * O texto original é preservado pelo chamador — a função não altera a entrada.
 */
import { composeDescription, normalizeDescription, normalizeText } from '../../../src/domain/finance/text';

describe('finance text (F2.1)', () => {
  describe('normalizeText', () => {
    it('uppercases e remove acentos', () => {
      expect(normalizeText('Transferência Pix Recebida')).toBe('TRANSFERENCIA PIX RECEBIDA');
    });

    it('troca pontuação por espaço e colapsa espaços', () => {
      expect(normalizeText('SAO  JOSE, LTDA.')).toBe('SAO JOSE LTDA');
    });

    it('não remove ruído (PIX/TIT/PAGTO sobrevivem)', () => {
      expect(normalizeText('PIX TIT PAGTO')).toBe('PIX TIT PAGTO');
    });
  });

  describe('normalizeDescription', () => {
    it('remove tokens de ruído', () => {
      expect(normalizeDescription('PIX RECEBIDO JOAO SILVA')).toBe('JOAO SILVA');
      expect(normalizeDescription('COMPRA CARTAO CREDITO')).toBe('CARTAO CREDITO');
      expect(normalizeDescription('DEB CONTA 1234')).toBe('CONTA 1234');
    });

    it('remove datas em formatos dd/mm/aaaa, aaaa-mm-dd e aaaammdd', () => {
      expect(normalizeDescription('PAGTO 18/11/2026 BOLETO')).toBe('BOLETO');
      expect(normalizeDescription('PAGTO 2026-11-18 BOLETO')).toBe('BOLETO');
      expect(normalizeDescription('PAGTO 20261118 BOLETO')).toBe('BOLETO');
    });

    it('remove sequências com mais de 6 dígitos e mantém as de 6', () => {
      expect(normalizeDescription('CONTA 123456789')).toBe('CONTA');
      expect(normalizeDescription('CONTA 123456')).toBe('CONTA 123456');
    });

    it('normaliza acentos e pontuação', () => {
      expect(normalizeDescription('Padaria São José, LTDA.')).toBe('PADARIA SAO JOSE LTDA');
    });

    it('não altera a string original', () => {
      const original = 'PIX RECEBIDO José';
      normalizeDescription(original);
      expect(original).toBe('PIX RECEBIDO José');
    });
  });

  describe('composeDescription', () => {
    it('concatena NAME e MEMO quando não há sobreposição', () => {
      expect(composeDescription('ALFA', 'BETA')).toBe('ALFA BETA');
    });

    it('não duplica quando o memo contém o name', () => {
      expect(composeDescription('CLIENTE LTDA', 'PIX RECEBIDO CLIENTE LTDA')).toBe(
        'PIX RECEBIDO CLIENTE LTDA'
      );
    });

    it('não duplica quando o name contém o memo', () => {
      expect(composeDescription('PIX RECEBIDO CLIENTE 01', 'PIX RECEBIDO')).toBe(
        'PIX RECEBIDO CLIENTE 01'
      );
    });

    it('devolve string vazia quando não há nada', () => {
      expect(composeDescription(undefined, undefined)).toBe('');
      expect(composeDescription('  ', undefined)).toBe('');
    });
  });
});
