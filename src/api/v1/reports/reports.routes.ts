import { Router } from 'express';
import { reportsController } from './reports.controller';
import { authenticate } from '../../../middlewares/auth.jwt';

const router = Router();

// =============================================
// DASHBOARD
// =============================================
router.get('/dashboard', authenticate, reportsController.dashboard);

// =============================================
// RELATÓRIOS FINANCEIROS
// =============================================
router.get('/financial/revenue', authenticate, reportsController.revenueByPeriod);
router.get('/financial/payment-methods', authenticate, reportsController.revenueByPaymentMethod);
router.get('/financial/services', authenticate, reportsController.profitableServices);
router.get('/financial/complete', authenticate, reportsController.financialComplete);

// =============================================
// RELATÓRIOS DE AGENDAMENTOS
// =============================================
router.get('/appointments/stats', authenticate, reportsController.appointmentsStats);
router.get('/appointments/occupancy', authenticate, reportsController.occupancyRate);

// =============================================
// RELATÓRIOS DE PRODUTOS
// =============================================
router.get('/products/top-selling', authenticate, reportsController.topSellingProducts);
router.get('/products/low-stock', authenticate, reportsController.lowStockProducts);
router.get('/products/stock-movement', authenticate, reportsController.stockMovement);

// =============================================
// RELATÓRIOS DE CLIENTES
// =============================================
router.get('/clients/analysis', authenticate, reportsController.clientsAnalysis);
router.get('/clients/inactive', authenticate, reportsController.inactiveClients);
router.get('/clients/loyalty', authenticate, reportsController.loyaltyAnalysis);

// =============================================
// COMISSÕES
// =============================================
router.get('/commissions', authenticate, reportsController.commissions);

// =============================================
// DOWNLOADS - EXCEL
// =============================================
router.get('/download/dashboard/excel', authenticate, reportsController.downloadDashboardExcel);
router.get('/download/financial/complete/excel', authenticate, reportsController.downloadFinancialCompleteExcel);
router.get('/download/appointments/stats/excel', authenticate, reportsController.downloadAppointmentsStatsExcel);
router.get('/download/products/top-selling/excel', authenticate, reportsController.downloadTopSellingProductsExcel);
router.get('/download/products/low-stock/excel', authenticate, reportsController.downloadLowStockProductsExcel);
router.get('/download/clients/analysis/excel', authenticate, reportsController.downloadClientsAnalysisExcel);
router.get('/download/clients/inactive/excel', authenticate, reportsController.downloadInactiveClientsExcel);
router.get('/download/clients/loyalty/excel', authenticate, reportsController.downloadLoyaltyAnalysisExcel);

// =============================================
// DOWNLOADS - PDF
// =============================================
router.get('/download/dashboard/pdf', authenticate, reportsController.downloadDashboardPDF);
router.get('/download/financial/complete/pdf', authenticate, reportsController.downloadFinancialCompletePDF);
router.get('/download/appointments/stats/pdf', authenticate, reportsController.downloadAppointmentsStatsPDF);
router.get('/download/products/top-selling/pdf', authenticate, reportsController.downloadTopSellingProductsPDF);
router.get('/download/clients/analysis/pdf', authenticate, reportsController.downloadClientsAnalysisPDF);

export default router;
