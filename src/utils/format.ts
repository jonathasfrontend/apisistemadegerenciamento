/**
 * Formatação de data/hora em pt-BR no fuso de São Paulo.
 * Fonte única: as mensagens de notificação e agenda usam o mesmo formato.
 */
export const formatDateTime = (d: Date) =>
  new Date(d).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  });
