import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Response } from 'express';
import { logger } from '../../../utils/logger';

export class ReportsExportService {
  
  // =============================================
  // UTILITÁRIOS DE FORMATAÇÃO
  // =============================================

  private formatCurrency(value: number): string {
    return `R$ ${value.toFixed(2).replace('.', ',')}`;
  }

  private formatDate(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleDateString('pt-BR');
  }

  private formatDateTime(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleString('pt-BR');
  }

  private formatPercentage(value: number): string {
    return `${value.toFixed(2)}%`;
  }

  // =============================================
  // EXCEL - DASHBOARD GERAL
  // =============================================

  async exportDashboardToExcel(data: any, res: Response): Promise<void> {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Dashboard Geral');

      // Cabeçalho
      worksheet.mergeCells('A1:D1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = '📊 DASHBOARD GERAL - RELATÓRIO';
      titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getRow(1).height = 30;

      // Período
      worksheet.mergeCells('A2:D2');
      const periodCell = worksheet.getCell('A2');
      periodCell.value = `Período: ${this.formatDate(data.period.start)} a ${this.formatDate(data.period.end)}`;
      periodCell.font = { size: 12, bold: true };
      periodCell.alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getRow(2).height = 25;

      // Espaçamento
      worksheet.addRow([]);

      // Seção de Métricas Principais
      worksheet.addRow(['MÉTRICAS PRINCIPAIS']).font = { bold: true, size: 12 };
      worksheet.addRow(['Métrica', 'Valor']);
      worksheet.addRow(['Total de Agendamentos', data.appointments?.total || 0]);
      worksheet.addRow(['Receita Total', this.formatCurrency(data.revenue?.total || 0)]);
      worksheet.addRow(['Total de Pagamentos', data.revenue?.count || 0]);
      worksheet.addRow(['Despesas Totais', this.formatCurrency(data.expenses?.total || 0)]);
      worksheet.addRow(['Lucro Líquido', this.formatCurrency(data.profit || 0)]);
      worksheet.addRow(['Novos Clientes', data.newClients || 0]);

      // Formatação das colunas
      worksheet.columns = [
        { key: 'label', width: 30 },
        { key: 'value', width: 20 },
        { key: 'extra1', width: 20 },
        { key: 'extra2', width: 20 }
      ];

      // Estilizar cabeçalhos
      const headerRow = worksheet.getRow(5);
      headerRow.font = { bold: true };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

      // Bordas
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber >= 5) {
          row.eachCell((cell) => {
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
          });
        }
      });

      // Configurar resposta
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=dashboard_${Date.now()}.xlsx`
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      logger.error('Error exporting dashboard to Excel:', error);
      throw error;
    }
  }

  // =============================================
  // EXCEL - RELATÓRIO FINANCEIRO COMPLETO
  // =============================================

  async exportFinancialCompleteToExcel(data: any, res: Response): Promise<void> {
    try {
      const workbook = new ExcelJS.Workbook();
      
      // Aba 1: Resumo
      const summarySheet = workbook.addWorksheet('Resumo Financeiro');
      this.addFinancialSummarySheet(summarySheet, data);

      // Aba 2: Receita por Período
      if (data.revenueByPeriod) {
        const revenueSheet = workbook.addWorksheet('Receita por Período');
        this.addRevenueByPeriodSheet(revenueSheet, data.revenueByPeriod);
      }

      // Aba 3: Métodos de Pagamento
      if (data.revenueByMethod) {
        const methodsSheet = workbook.addWorksheet('Métodos de Pagamento');
        this.addPaymentMethodsSheet(methodsSheet, data.revenueByMethod);
      }

      // Aba 4: Serviços Lucrativos
      if (data.profitableServices) {
        const servicesSheet = workbook.addWorksheet('Serviços Lucrativos');
        this.addProfitableServicesSheet(servicesSheet, data.profitableServices);
      }

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=relatorio_financeiro_completo_${Date.now()}.xlsx`
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      logger.error('Error exporting financial report to Excel:', error);
      throw error;
    }
  }

  private addFinancialSummarySheet(worksheet: ExcelJS.Worksheet, data: any): void {
    worksheet.mergeCells('A1:B1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = '💰 RESUMO FINANCEIRO';
    titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 30;

    worksheet.addRow([]);
    worksheet.addRow(['Métrica', 'Valor']).font = { bold: true };
    
    const summary = data.summary || {};
    worksheet.addRow(['Receita Total', this.formatCurrency(summary.revenue || 0)]);
    worksheet.addRow(['Despesas Totais', this.formatCurrency(summary.expenses || 0)]);
    worksheet.addRow(['Lucro Bruto', this.formatCurrency(summary.profit || 0)]);
    worksheet.addRow(['Comissões', this.formatCurrency(summary.commissions || 0)]);
    worksheet.addRow(['Lucro Líquido', this.formatCurrency(summary.netProfit || 0)]);

    worksheet.columns = [
      { key: 'label', width: 30 },
      { key: 'value', width: 20 }
    ];

    const headerRow = worksheet.getRow(3);
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= 3) {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      }
    });
  }

  private addRevenueByPeriodSheet(worksheet: ExcelJS.Worksheet, data: any): void {
    worksheet.mergeCells('A1:E1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = '📈 RECEITA POR PERÍODO';
    titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

    worksheet.addRow([]);
    worksheet.addRow(['Data', 'Receita', 'Despesas', 'Lucro', 'Crescimento']).font = { bold: true };

    if (data.dailyData && Array.isArray(data.dailyData)) {
      data.dailyData.forEach((day: any) => {
        worksheet.addRow([
          this.formatDate(day.date),
          this.formatCurrency(day.revenue || 0),
          this.formatCurrency(day.despesas || 0),
          this.formatCurrency(day.lucro || 0),
          day.growth ? this.formatPercentage(day.growth) : '-'
        ]);
      });
    }

    worksheet.columns = [
      { key: 'date', width: 15 },
      { key: 'revenue', width: 15 },
      { key: 'expenses', width: 15 },
      { key: 'profit', width: 15 },
      { key: 'growth', width: 15 }
    ];

    const headerRow = worksheet.getRow(3);
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  }

  private addPaymentMethodsSheet(worksheet: ExcelJS.Worksheet, data: any): void {
    worksheet.mergeCells('A1:D1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = '💳 MÉTODOS DE PAGAMENTO';
    titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

    worksheet.addRow([]);
    worksheet.addRow(['Método', 'Total', 'Quantidade', 'Percentual']).font = { bold: true };

    if (data.methods && Array.isArray(data.methods)) {
      data.methods.forEach((method: any) => {
        worksheet.addRow([
          method.method,
          this.formatCurrency(method.total || 0),
          method.count || 0,
          this.formatPercentage(method.percentage || 0)
        ]);
      });
    }

    worksheet.columns = [
      { key: 'method', width: 20 },
      { key: 'total', width: 15 },
      { key: 'count', width: 15 },
      { key: 'percentage', width: 15 }
    ];

    const headerRow = worksheet.getRow(3);
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  }

  private addProfitableServicesSheet(worksheet: ExcelJS.Worksheet, data: any): void {
    worksheet.mergeCells('A1:E1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = '🌟 SERVIÇOS MAIS LUCRATIVOS';
    titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };

    worksheet.addRow([]);
    worksheet.addRow(['Serviço', 'Receita', 'Vezes Reservado', 'Preço Médio', 'Percentual']).font = { bold: true };

    if (data.services && Array.isArray(data.services)) {
      data.services.forEach((service: any) => {
        worksheet.addRow([
          service.serviceName,
          this.formatCurrency(service.totalRevenue || 0),
          service.timesBooked || 0,
          this.formatCurrency(service.averagePrice || 0),
          this.formatPercentage(service.percentage || 0)
        ]);
      });
    }

    worksheet.columns = [
      { key: 'service', width: 30 },
      { key: 'revenue', width: 15 },
      { key: 'times', width: 15 },
      { key: 'avg', width: 15 },
      { key: 'percentage', width: 15 }
    ];

    const headerRow = worksheet.getRow(3);
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
  }

  // =============================================
  // EXCEL - AGENDAMENTOS
  // =============================================

  async exportAppointmentsStatsToExcel(data: any, res: Response): Promise<void> {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Estatísticas de Agendamentos');

      // Título
      worksheet.mergeCells('A1:E1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = '📅 ESTATÍSTICAS DE AGENDAMENTOS';
      titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getRow(1).height = 30;

      // Período
      worksheet.mergeCells('A2:E2');
      worksheet.getCell('A2').value = `Período: ${this.formatDate(data.period.start)} a ${this.formatDate(data.period.end)}`;
      worksheet.getCell('A2').alignment = { horizontal: 'center' };

      worksheet.addRow([]);

      // Resumo
      worksheet.addRow(['RESUMO']).font = { bold: true, size: 12 };
      worksheet.addRow(['Métrica', 'Valor']);
      worksheet.addRow(['Total de Agendamentos', data.summary?.total || 0]);
      worksheet.addRow(['Concluídos', data.summary?.completed || 0]);
      worksheet.addRow(['Cancelados', data.summary?.cancelled || 0]);
      worksheet.addRow(['Não Compareceu', data.summary?.noShow || 0]);
      worksheet.addRow(['Taxa de Conclusão', this.formatPercentage(data.summary?.completionRate || 0)]);
      worksheet.addRow(['Taxa de Cancelamento', this.formatPercentage(data.summary?.cancellationRate || 0)]);

      worksheet.addRow([]);

      // Por Profissional
      worksheet.addRow(['DESEMPENHO POR PROFISSIONAL']).font = { bold: true, size: 12 };
      worksheet.addRow(['Profissional', 'Agendamentos', 'Receita', 'Ticket Médio']);

      if (data.byStaff && Array.isArray(data.byStaff)) {
        data.byStaff.forEach((staff: any) => {
          worksheet.addRow([
            staff.staffName,
            staff.appointmentsCount,
            this.formatCurrency(staff.totalRevenue || 0),
            this.formatCurrency(staff.averageTicket || 0)
          ]);
        });
      }

      worksheet.columns = [
        { key: 'col1', width: 30 },
        { key: 'col2', width: 20 },
        { key: 'col3', width: 20 },
        { key: 'col4', width: 20 },
        { key: 'col5', width: 20 }
      ];

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=estatisticas_agendamentos_${Date.now()}.xlsx`
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      logger.error('Error exporting appointments stats to Excel:', error);
      throw error;
    }
  }

  // =============================================
  // EXCEL - PRODUTOS
  // =============================================

  async exportProductsReportToExcel(data: any, reportType: string, res: Response): Promise<void> {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Relatório de Produtos');

      let title = '📦 RELATÓRIO DE PRODUTOS';
      if (reportType === 'top-selling') title = '🏆 PRODUTOS MAIS VENDIDOS';
      else if (reportType === 'low-stock') title = '⚠️ PRODUTOS COM ESTOQUE BAIXO';
      else if (reportType === 'stock-movement') title = '📊 MOVIMENTAÇÃO DE ESTOQUE';

      worksheet.mergeCells('A1:F1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = title;
      titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getRow(1).height = 30;

      worksheet.addRow([]);

      if (reportType === 'top-selling') {
        worksheet.addRow(['Produto', 'Categoria', 'Qtd Vendida', 'Receita', 'Lucro', 'Margem']).font = { bold: true };
        if (data.products && Array.isArray(data.products)) {
          data.products.forEach((product: any) => {
            worksheet.addRow([
              product.productName,
              product.category,
              product.quantitySold,
              this.formatCurrency(product.revenue || 0),
              this.formatCurrency(product.profit || 0),
              this.formatPercentage(product.profitMargin || 0)
            ]);
          });
        }
      } else if (reportType === 'low-stock') {
        worksheet.addRow(['Produto', 'SKU', 'Categoria', 'Quantidade', 'Mínimo', 'Status']).font = { bold: true };
        if (data.products && Array.isArray(data.products)) {
          data.products.forEach((product: any) => {
            worksheet.addRow([
              product.name,
              product.sku,
              product.category,
              product.quantity,
              product.reorderThreshold,
              product.status
            ]);
          });
        }
      }

      worksheet.columns = [
        { key: 'col1', width: 25 },
        { key: 'col2', width: 20 },
        { key: 'col3', width: 15 },
        { key: 'col4', width: 15 },
        { key: 'col5', width: 15 },
        { key: 'col6', width: 15 }
      ];

      const headerRow = worksheet.getRow(3);
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=relatorio_produtos_${reportType}_${Date.now()}.xlsx`
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      logger.error('Error exporting products report to Excel:', error);
      throw error;
    }
  }

  // =============================================
  // EXCEL - CLIENTES
  // =============================================

  async exportClientsReportToExcel(data: any, reportType: string, res: Response): Promise<void> {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Relatório de Clientes');

      let title = '👥 RELATÓRIO DE CLIENTES';
      if (reportType === 'analysis') title = '📊 ANÁLISE DE CLIENTES';
      else if (reportType === 'inactive') title = '😴 CLIENTES INATIVOS';
      else if (reportType === 'loyalty') title = '⭐ PROGRAMA DE FIDELIDADE';

      worksheet.mergeCells('A1:F1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = title;
      titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getRow(1).height = 30;

      worksheet.addRow([]);

      if (reportType === 'analysis') {
        worksheet.addRow(['Cliente', 'Telefone', 'Gasto Total', 'Transações', 'Pontos', 'Ticket Médio']).font = { bold: true };
        if (data.topClients && Array.isArray(data.topClients)) {
          data.topClients.forEach((client: any) => {
            worksheet.addRow([
              client.clientName,
              client.clientPhone,
              this.formatCurrency(client.totalSpent || 0),
              client.transactionCount,
              client.loyaltyPoints,
              this.formatCurrency(client.averageTicket || 0)
            ]);
          });
        }
      } else if (reportType === 'inactive') {
        worksheet.addRow(['Cliente', 'Telefone', 'Email', 'Última Visita', 'Dias Inativo', 'Gasto Total']).font = { bold: true };
        if (data.clients && Array.isArray(data.clients)) {
          data.clients.forEach((client: any) => {
            worksheet.addRow([
              client.name,
              client.phone,
              client.email,
              this.formatDate(client.lastVisit),
              client.daysSinceLastVisit,
              this.formatCurrency(client.totalSpent || 0)
            ]);
          });
        }
      } else if (reportType === 'loyalty') {
        worksheet.addRow(['Cliente', 'Telefone', 'Pontos', 'Agendamentos', 'Membro Desde']).font = { bold: true };
        if (data.topLoyalClients && Array.isArray(data.topLoyalClients)) {
          data.topLoyalClients.forEach((client: any) => {
            worksheet.addRow([
              client.name,
              client.phone,
              client.points,
              client.appointmentsCount,
              this.formatDate(client.memberSince)
            ]);
          });
        }
      }

      worksheet.columns = [
        { key: 'col1', width: 25 },
        { key: 'col2', width: 20 },
        { key: 'col3', width: 20 },
        { key: 'col4', width: 20 },
        { key: 'col5', width: 15 },
        { key: 'col6', width: 20 }
      ];

      const headerRow = worksheet.getRow(3);
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=relatorio_clientes_${reportType}_${Date.now()}.xlsx`
      );

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      logger.error('Error exporting clients report to Excel:', error);
      throw error;
    }
  }

  // =============================================
  // PDF - DASHBOARD GERAL
  // =============================================

  async exportDashboardToPDF(data: any, res: Response): Promise<void> {
    try {
      const doc = new PDFDocument({ margin: 50 });
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=dashboard_${Date.now()}.pdf`);
      
      doc.pipe(res);

      // Título
      doc.fontSize(20).fillColor('#4F81BD').text('📊 DASHBOARD GERAL - RELATÓRIO', { align: 'center' });
      doc.moveDown();

      // Período
      doc.fontSize(12).fillColor('#000000')
        .text(`Período: ${this.formatDate(data.period.start)} a ${this.formatDate(data.period.end)}`, { align: 'center' });
      doc.moveDown(2);

      // Linha separadora
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      // Métricas Principais
      doc.fontSize(14).fillColor('#4F81BD').text('MÉTRICAS PRINCIPAIS');
      doc.moveDown(0.5);

      const metrics = [
        ['Total de Agendamentos:', data.appointments?.total || 0],
        ['Receita Total:', this.formatCurrency(data.revenue?.total || 0)],
        ['Total de Pagamentos:', data.revenue?.count || 0],
        ['Despesas Totais:', this.formatCurrency(data.expenses?.total || 0)],
        ['Lucro Líquido:', this.formatCurrency(data.profit || 0)],
        ['Novos Clientes:', data.newClients || 0]
      ];

      doc.fontSize(11).fillColor('#000000');
      metrics.forEach(([label, value]) => {
        doc.text(`${label} ${value}`, { continued: false });
        doc.moveDown(0.3);
      });

      // Rodapé
      doc.moveDown(3);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('#666666')
        .text(`Gerado em: ${this.formatDateTime(new Date())}`, { align: 'center' });

      doc.end();
    } catch (error) {
      logger.error('Error exporting dashboard to PDF:', error);
      throw error;
    }
  }

  // =============================================
  // PDF - RELATÓRIO FINANCEIRO COMPLETO
  // =============================================

  async exportFinancialCompleteToPDF(data: any, res: Response): Promise<void> {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=relatorio_financeiro_${Date.now()}.pdf`);
      
      doc.pipe(res);

      // Título
      doc.fontSize(20).fillColor('#4F81BD').text('💰 RELATÓRIO FINANCEIRO COMPLETO', { align: 'center' });
      doc.moveDown(2);

      // Resumo Financeiro
      doc.fontSize(14).fillColor('#4F81BD').text('RESUMO FINANCEIRO');
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      const summary = data.summary || {};
      doc.fontSize(11).fillColor('#000000');
      doc.text(`Receita Total: ${this.formatCurrency(summary.revenue || 0)}`);
      doc.text(`Despesas Totais: ${this.formatCurrency(summary.expenses || 0)}`);
      doc.text(`Lucro Bruto: ${this.formatCurrency(summary.profit || 0)}`);
      doc.text(`Comissões: ${this.formatCurrency(summary.commissions || 0)}`);
      doc.fontSize(12).fillColor('#008000')
        .text(`Lucro Líquido: ${this.formatCurrency(summary.netProfit || 0)}`, { underline: true });
      doc.moveDown(2);

      // Métodos de Pagamento
      if (data.revenueByMethod?.methods) {
        doc.fontSize(14).fillColor('#4F81BD').text('MÉTODOS DE PAGAMENTO');
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();

        doc.fontSize(11).fillColor('#000000');
        data.revenueByMethod.methods.forEach((method: any) => {
          doc.text(`${method.method}: ${this.formatCurrency(method.total)} (${method.count} transações - ${this.formatPercentage(method.percentage)})`);
          doc.moveDown(0.3);
        });
        doc.moveDown();
      }

      // Serviços Mais Lucrativos
      if (data.profitableServices?.services && doc.y < 650) {
        doc.fontSize(14).fillColor('#4F81BD').text('TOP 5 SERVIÇOS MAIS LUCRATIVOS');
        doc.moveDown(0.5);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();

        doc.fontSize(11).fillColor('#000000');
        data.profitableServices.services.slice(0, 5).forEach((service: any, index: number) => {
          doc.text(`${index + 1}. ${service.serviceName}: ${this.formatCurrency(service.totalRevenue)} (${service.timesBooked} vezes)`);
          doc.moveDown(0.3);
        });
      }

      // Rodapé
      doc.moveDown(2);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('#666666')
        .text(`Gerado em: ${this.formatDateTime(new Date())}`, { align: 'center' });

      doc.end();
    } catch (error) {
      logger.error('Error exporting financial report to PDF:', error);
      throw error;
    }
  }

  // =============================================
  // PDF - GENÉRICO (para outros relatórios)
  // =============================================

  async exportGenericReportToPDF(title: string, data: any, res: Response): Promise<void> {
    try {
      const doc = new PDFDocument({ margin: 50 });
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=relatorio_${Date.now()}.pdf`);
      
      doc.pipe(res);

      // Título
      doc.fontSize(20).fillColor('#4F81BD').text(title, { align: 'center' });
      doc.moveDown(2);

      // Conteúdo (simples - pode ser expandido conforme necessário)
      doc.fontSize(11).fillColor('#000000');
      doc.text(JSON.stringify(data, null, 2));

      // Rodapé
      doc.moveDown(2);
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(9).fillColor('#666666')
        .text(`Gerado em: ${this.formatDateTime(new Date())}`, { align: 'center' });

      doc.end();
    } catch (error) {
      logger.error('Error exporting generic report to PDF:', error);
      throw error;
    }
  }
}

export const reportsExportService = new ReportsExportService();
