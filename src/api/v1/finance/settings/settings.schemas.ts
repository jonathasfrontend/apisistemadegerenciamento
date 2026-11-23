import { z } from 'zod';

export const updateSettingsSchema = z.object({
  body: z.object({
    requireOpenCashSession: z.boolean().optional(),
    cashClosingTolerance: z.number().min(0).optional(),
    matchWindowDays: z.number().int().min(0).max(365).optional(),
    autoConfirmScore: z.number().int().min(0).max(100).nullable().optional(),
    cardTolerancePct: z.number().min(0).max(100).optional(),
    fileRetentionDays: z.number().int().min(1).max(3650).optional(),
    enableOverdueAlerts: z.boolean().optional(),
  }),
});
