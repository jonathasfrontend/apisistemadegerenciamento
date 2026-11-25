/**
 * [F2.1] Decodificação de arquivos OFX — spec §7.2 (FINANCEIRO_IMPLEMENTACAO.md:1227).
 *
 * Extrato brasileiro costuma vir em Windows-1252 (`CHARSET:1252`), onde acentos
 * quebram se o arquivo for lido como UTF-8. O cabeçalho OFX é a fonte da
 * verdade; na ausência dele, assume-se win1252.
 */
import iconv from 'iconv-lite';

export function decodeOfx(buf: Buffer): string {
  const head = buf.subarray(0, 800).toString('latin1');
  const isUtf8 = /ENCODING:\s*UTF-?8/i.test(head) || /CHARSET:\s*65001/i.test(head);
  return iconv.decode(buf, isUtf8 ? 'utf8' : 'win1252');
}
