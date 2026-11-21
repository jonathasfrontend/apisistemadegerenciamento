import { Request, Response } from 'express';
import { ReportsService } from './reports.service';
import { ReportsExportService } from './reports-export.service';
import { logger } from '../../../utils/logger';

export class ReportsController {
  private reportsService: ReportsService;
  private exportService: ReportsExportService;

  constructor() {
    this.reportsService = new ReportsService();
    this.exportService = new ReportsExportService();
  }

  // =============================================
  // DASHBOARD GERAL
  // =============================================
  
  dashboard = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      const report = await this.reportsService.getDashboard(
        startDate ? new Date(startDate as string) : new Date(new Date().setDate(1)),
        endDate ? new Date(endDate as string) : new Date(),
        req.user!.companyId
      );
      res.json({ status: 'success', data: report });
    } catch (error: any) {
      logger.error('Error generating dashboard:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  // =============================================
  // RELATÓRIOS FINANCEIROS
  // =============================================

  /**
   * GET /api/v1/reports/financial/revenue
   * Receita por período com comparação
   */
  revenueByPeriod = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const report = await this.reportsService.getRevenueByPeriod(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      res.json({ status: 'success', data: report });
    } catch (error: any) {
      logger.error('Error generating revenue by period report:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/financial/payment-methods
   * Receita por método de pagamento
   */
  revenueByPaymentMethod = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const report = await this.reportsService.getRevenueByPaymentMethod(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      res.json({ status: 'success', data: report });
    } catch (error: any) {
      logger.error('Error generating revenue by payment method report:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/financial/services
   * Serviços mais lucrativos
   */
  profitableServices = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const report = await this.reportsService.getMostProfitableServices(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      res.json({ status: 'success', data: report });
    } catch (error: any) {
      logger.error('Error generating profitable services report:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/financial/complete
   * Relatório financeiro completo
   */
  financialComplete = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const report = await this.reportsService.getFinancialComplete(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      res.json({ status: 'success', data: report });
    } catch (error: any) {
      logger.error('Error generating complete financial report:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  // =============================================
  // RELATÓRIOS DE AGENDAMENTOS
  // =============================================

  /**
   * GET /api/v1/reports/appointments/stats
   * Estatísticas de agendamentos
   */
  appointmentsStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const report = await this.reportsService.getAppointmentsStats(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      res.json({ status: 'success', data: report });
    } catch (error: any) {
      logger.error('Error generating appointments stats:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/appointments/occupancy
   * Taxa de ocupação por profissional
   */
  occupancyRate = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const report = await this.reportsService.getOccupancyRate(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      res.json({ status: 'success', data: report });
    } catch (error: any) {
      logger.error('Error generating occupancy rate:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  // =============================================
  // RELATÓRIOS DE PRODUTOS
  // =============================================

  /**
   * GET /api/v1/reports/products/top-selling
   * Produtos mais vendidos
   */
  topSellingProducts = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const report = await this.reportsService.getTopSellingProducts(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      res.json({ status: 'success', data: report });
    } catch (error: any) {
      logger.error('Error generating top selling products report:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/products/low-stock
   * Produtos com estoque baixo
   */
  lowStockProducts = async (req: Request, res: Response): Promise<void> => {
    try {
      const report = await this.reportsService.getLowStockProducts(req.user!.companyId);
      res.json({ status: 'success', data: report });
    } catch (error: any) {
      logger.error('Error generating low stock report:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/products/stock-movement
   * Análise de movimentação de estoque
   */
  stockMovement = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const report = await this.reportsService.getStockMovementAnalysis(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      res.json({ status: 'success', data: report });
    } catch (error: any) {
      logger.error('Error generating stock movement report:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  // =============================================
  // RELATÓRIOS DE CLIENTES
  // =============================================

  /**
   * GET /api/v1/reports/clients/analysis
   * Análise de clientes
   */
  clientsAnalysis = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const report = await this.reportsService.getClientsAnalysis(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      res.json({ status: 'success', data: report });
    } catch (error: any) {
      logger.error('Error generating clients analysis:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/clients/inactive
   * Clientes inativos para reativação
   */
  inactiveClients = async (req: Request, res: Response): Promise<void> => {
    try {
      const { daysInactive } = req.query;
      const days = daysInactive ? parseInt(daysInactive as string) : 60;
      const report = await this.reportsService.getInactiveClients(days, req.user!.companyId);
      res.json({ status: 'success', data: report });
    } catch (error: any) {
      logger.error('Error generating inactive clients report:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/clients/loyalty
   * Análise de programa de fidelidade
   */
  loyaltyAnalysis = async (req: Request, res: Response): Promise<void> => {
    try {
      const report = await this.reportsService.getLoyaltyAnalysis(req.user!.companyId);
      res.json({ status: 'success', data: report });
    } catch (error: any) {
      logger.error('Error generating loyalty analysis:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  // =============================================
  // COMISSÕES (Mantido)
  // =============================================

  /**
   * GET /api/v1/reports/commissions
   * Relatório de comissões
   */
  commissions = async (req: Request, res: Response): Promise<void> => {
    try {
      const { staffId, startDate, endDate } = req.query;
      const report = await this.reportsService.getCommissions(
        req.user!.companyId,
        staffId as string,
        startDate ? new Date(startDate as string) : undefined,
        endDate ? new Date(endDate as string) : undefined
      );
      res.json({ status: 'success', data: report });
    } catch (error: any) {
      logger.error('Error generating commissions report:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  // =============================================
  // DOWNLOADS - EXCEL
  // =============================================

  /**
   * GET /api/v1/reports/download/dashboard/excel
   * Download do dashboard em Excel
   */
  downloadDashboardExcel = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      const data = await this.reportsService.getDashboard(
        startDate ? new Date(startDate as string) : new Date(new Date().setDate(1)),
        endDate ? new Date(endDate as string) : new Date(),
        req.user!.companyId
      );
      await this.exportService.exportDashboardToExcel(data, res);
    } catch (error: any) {
      logger.error('Error downloading dashboard Excel:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/download/financial/complete/excel
   * Download do relatório financeiro completo em Excel
   */
  downloadFinancialCompleteExcel = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const data = await this.reportsService.getFinancialComplete(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      await this.exportService.exportFinancialCompleteToExcel(data, res);
    } catch (error: any) {
      logger.error('Error downloading financial complete Excel:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/download/appointments/stats/excel
   * Download das estatísticas de agendamentos em Excel
   */
  downloadAppointmentsStatsExcel = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const data = await this.reportsService.getAppointmentsStats(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      await this.exportService.exportAppointmentsStatsToExcel(data, res);
    } catch (error: any) {
      logger.error('Error downloading appointments stats Excel:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/download/products/top-selling/excel
   * Download dos produtos mais vendidos em Excel
   */
  downloadTopSellingProductsExcel = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const data = await this.reportsService.getTopSellingProducts(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      await this.exportService.exportProductsReportToExcel(data, 'top-selling', res);
    } catch (error: any) {
      logger.error('Error downloading top selling products Excel:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/download/products/low-stock/excel
   * Download dos produtos com estoque baixo em Excel
   */
  downloadLowStockProductsExcel = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.reportsService.getLowStockProducts(req.user!.companyId);
      await this.exportService.exportProductsReportToExcel(data, 'low-stock', res);
    } catch (error: any) {
      logger.error('Error downloading low stock products Excel:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/download/clients/analysis/excel
   * Download da análise de clientes em Excel
   */
  downloadClientsAnalysisExcel = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const data = await this.reportsService.getClientsAnalysis(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      await this.exportService.exportClientsReportToExcel(data, 'analysis', res);
    } catch (error: any) {
      logger.error('Error downloading clients analysis Excel:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/download/clients/inactive/excel
   * Download dos clientes inativos em Excel
   */
  downloadInactiveClientsExcel = async (req: Request, res: Response): Promise<void> => {
    try {
      const { daysInactive } = req.query;
      const days = daysInactive ? parseInt(daysInactive as string) : 60;
      const data = await this.reportsService.getInactiveClients(days, req.user!.companyId);
      await this.exportService.exportClientsReportToExcel(data, 'inactive', res);
    } catch (error: any) {
      logger.error('Error downloading inactive clients Excel:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/download/clients/loyalty/excel
   * Download da análise de fidelidade em Excel
   */
  downloadLoyaltyAnalysisExcel = async (req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.reportsService.getLoyaltyAnalysis(req.user!.companyId);
      await this.exportService.exportClientsReportToExcel(data, 'loyalty', res);
    } catch (error: any) {
      logger.error('Error downloading loyalty analysis Excel:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  // =============================================
  // DOWNLOADS - PDF
  // =============================================

  /**
   * GET /api/v1/reports/download/dashboard/pdf
   * Download do dashboard em PDF
   */
  downloadDashboardPDF = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      const data = await this.reportsService.getDashboard(
        startDate ? new Date(startDate as string) : new Date(new Date().setDate(1)),
        endDate ? new Date(endDate as string) : new Date(),
        req.user!.companyId
      );
      await this.exportService.exportDashboardToPDF(data, res);
    } catch (error: any) {
      logger.error('Error downloading dashboard PDF:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/download/financial/complete/pdf
   * Download do relatório financeiro completo em PDF
   */
  downloadFinancialCompletePDF = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const data = await this.reportsService.getFinancialComplete(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      await this.exportService.exportFinancialCompleteToPDF(data, res);
    } catch (error: any) {
      logger.error('Error downloading financial complete PDF:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/download/appointments/stats/pdf
   * Download das estatísticas de agendamentos em PDF
   */
  downloadAppointmentsStatsPDF = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const data = await this.reportsService.getAppointmentsStats(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      await this.exportService.exportGenericReportToPDF('📅 ESTATÍSTICAS DE AGENDAMENTOS', data, res);
    } catch (error: any) {
      logger.error('Error downloading appointments stats PDF:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/download/products/top-selling/pdf
   * Download dos produtos mais vendidos em PDF
   */
  downloadTopSellingProductsPDF = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const data = await this.reportsService.getTopSellingProducts(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      await this.exportService.exportGenericReportToPDF('🏆 PRODUTOS MAIS VENDIDOS', data, res);
    } catch (error: any) {
      logger.error('Error downloading top selling products PDF:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  /**
   * GET /api/v1/reports/download/clients/analysis/pdf
   * Download da análise de clientes em PDF
   */
  downloadClientsAnalysisPDF = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        res.status(400).json({ 
          status: 'error', 
          message: 'startDate e endDate são obrigatórios' 
        });
        return;
      }
      const data = await this.reportsService.getClientsAnalysis(
        new Date(startDate as string),
        new Date(endDate as string),
        req.user!.companyId
      );
      await this.exportService.exportGenericReportToPDF('📊 ANÁLISE DE CLIENTES', data, res);
    } catch (error: any) {
      logger.error('Error downloading clients analysis PDF:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };
}

export const reportsController = new ReportsController();
