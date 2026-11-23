import prisma from '../../../../config/db';

export type UpdateSettingsInput = {
  requireOpenCashSession?: boolean;
  cashClosingTolerance?: number;
  matchWindowDays?: number;
  autoConfirmScore?: number | null;
  cardTolerancePct?: number;
  fileRetentionDays?: number;
  enableOverdueAlerts?: boolean;
};

export class SettingsService {
  /** Empresas provisionadas sem seed recebem os defaults na primeira leitura. */
  get(companyId: string) {
    return prisma.financeSettings.upsert({
      where: { companyId },
      update: {},
      create: { companyId },
    });
  }

  async update(companyId: string, data: UpdateSettingsInput) {
    await this.get(companyId);
    return prisma.financeSettings.update({ where: { companyId }, data });
  }
}

export const settingsService = new SettingsService();
