import { formatDateTime } from '../../../utils/format';

/**
 * Texto do aviso de pagamento pendente (redação do Jonathas):
 * `Pagamento do agendamento X com pagamento pendente`
 * — X = cliente + data/hora do agendamento.
 */
export const paymentPendingMessage = (clientName: string, startTime: Date) =>
  `Pagamento do agendamento de ${clientName} (${formatDateTime(startTime)}) com pagamento pendente`;

/**
 * Texto do aviso de pagamento confirmado (redação do Jonathas):
 * `Agendamento X Pago com sucesso!`
 * — X = cliente + data/hora do agendamento.
 */
export const paymentPaidMessage = (clientName: string, startTime: Date) =>
  `Agendamento de ${clientName} (${formatDateTime(startTime)}) Pago com sucesso!`;
