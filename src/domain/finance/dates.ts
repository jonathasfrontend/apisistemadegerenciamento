/**
 * [F1.3] Datas de liquidação — puro, sem I/O e sem dependência nova.
 * Timezone: operações em UTC para não depender do fuso do servidor.
 * Feriados ficam FORA do escopo (spec:1096): nextBusinessDay só pula
 * sábado/domingo. Cada adquirente tem calendário próprio; por isso a
 * conciliação usa janela de datas, não data exata.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Soma `days` dias corridos, preservando o horário UTC. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Sábado (6) e domingo (0) → próxima segunda-feira. */
export function nextBusinessDay(date: Date): Date {
  let result = new Date(date.getTime());
  while (result.getUTCDay() === 0 || result.getUTCDay() === 6) {
    result = addDays(result, 1);
  }
  return result;
}
