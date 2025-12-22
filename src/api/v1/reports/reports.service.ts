  import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class ReportsService {
  // =============================================
  // DASHBOARD GERAL
  // =============================================
  async getDashboard(startDate: Date, endDate: Date) {
    const [appointments, payments, expenses, clients] = await Promise.all([
      prisma.appointment.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      prisma.payment.aggregate({
        where: {
          status: 'PAID',
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.expense.aggregate({
        where: {
          isPaid: true,
          paidDate: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
      }),
      prisma.client.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
    ]);

    const revenue = payments._sum.amount || 0;
    const costs = expenses._sum.amount || 0;
    const profit = revenue - costs;

    return {
      period: { start: startDate, end: endDate },
      appointments: { total: appointments },
      revenue: { total: revenue, count: payments._count },
      expenses: { total: costs },
      profit,
      newClients: clients,
    };
  }

  // =============================================
  // RELATÓRIOS FINANCEIROS
  // =============================================
  
  /**
   * Receita por Período com comparação
   */
  async getRevenueByPeriod(startDate: Date, endDate: Date) {
    // Calcular período anterior para comparação
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const previousStart = new Date(startDate.getTime() - days * 24 * 60 * 60 * 1000);
    const previousEnd = new Date(startDate.getTime() - 1);

    const [currentPeriod, previousPeriod, expenses, currentExpenses, previousExpenses] = await Promise.all([
      // Receitas período atual
      prisma.payment.aggregate({
        where: {
          status: 'PAID',
          paidAt: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
        _count: true,
      }),
      // Receitas período anterior
      prisma.payment.aggregate({
        where: {
          status: 'PAID',
          paidAt: { gte: previousStart, lte: previousEnd },
        },
        _sum: { amount: true },
        _count: true,
      }),
      // Despesas período atual
      prisma.expense.aggregate({
        where: {
          isPaid: true,
          paidDate: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
      }),
      // Despesas detalhadas período atual
      prisma.expense.findMany({
        where: {
          paidDate: { gte: startDate, lte: endDate },
        },
        select: {
          id: true,
          description: true,
          category: true,
          amount: true,
          paidDate: true,
        },
      }),
      // Despesas período anterior
      prisma.expense.aggregate({
        where: {
          isPaid: true,
          paidDate: { gte: previousStart, lte: previousEnd },
        },
        _sum: { amount: true },
      }),
    ]);

    const currentRevenue = currentPeriod._sum.amount || 0;
    const previousRevenue = previousPeriod._sum.amount || 0;
    const currentExpensesTotal = expenses._sum.amount || 0;
    const previousExpensesTotal = previousExpenses._sum.amount || 0;
    const currentProfit = currentRevenue - currentExpensesTotal;
    const previousProfit = previousRevenue - previousExpensesTotal;

    // Cálculo de variação percentual
    const revenueGrowth = previousRevenue > 0 
      ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 
      : 0;
    const profitGrowth = previousProfit > 0 
      ? ((currentProfit - previousProfit) / previousProfit) * 100 
      : 0;

    // Receita por dia do período
    const dailyRevenue = await prisma.$queryRaw<Array<{date: Date, revenue: number, despesas: number, lucro: number}>>`
      WITH daily_payments AS (
        SELECT 
          DATE(paid_at) as date,
          COALESCE(SUM(amount), 0)::float as revenue
        FROM payments
        WHERE status = 'PAID'
        AND paid_at >= ${startDate}
        AND paid_at <= ${endDate}
        GROUP BY DATE(paid_at)
      ),
      daily_expenses AS (
        SELECT 
          DATE(paid_date) as date,
          COALESCE(SUM(amount), 0)::float as despesas
        FROM expenses
        WHERE is_paid = true
        AND paid_date >= ${startDate}
        AND paid_date <= ${endDate}
        GROUP BY DATE(paid_date)
      )
      SELECT 
        COALESCE(dp.date, de.date) as date,
        COALESCE(dp.revenue, 0) as revenue,
        COALESCE(de.despesas, 0) as despesas,
        COALESCE(dp.revenue, 0) - COALESCE(de.despesas, 0) as lucro
      FROM daily_payments dp
      FULL OUTER JOIN daily_expenses de ON dp.date = de.date
      ORDER BY date ASC
    `;

    return {
      period: {
        start: startDate,
        end: endDate,
        days,
      },
      current: {
        revenue: currentRevenue,
        expenses: currentExpensesTotal,
        profit: currentProfit,
        transactionCount: currentPeriod._count,
      },
      previous: {
        revenue: previousRevenue,
        expenses: previousExpensesTotal,
        profit: previousProfit,
        transactionCount: previousPeriod._count,
      },
      comparison: {
        revenueGrowth: Number(revenueGrowth.toFixed(2)),
        profitGrowth: Number(profitGrowth.toFixed(2)),
        expensesGrowth: previousExpensesTotal > 0 
          ? Number((((currentExpensesTotal - previousExpensesTotal) / previousExpensesTotal) * 100).toFixed(2))
          : 0,
      },
      dailyData: dailyRevenue.map(d => ({
        date: d.date,
        revenue: Number(d.revenue),
        despesas: Number(d.despesas),
        lucro: Number(d.lucro),
      })),
      expenseDetails: currentExpenses,
    };
  }

  /**
   * Receita por Método de Pagamento
   */
  async getRevenueByPaymentMethod(startDate: Date, endDate: Date) {
    const paymentsByMethod = await prisma.payment.groupBy({
      by: ['method'],
      where: {
        status: 'PAID',
        paidAt: { gte: startDate, lte: endDate },
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const total = paymentsByMethod.reduce((sum, p) => sum + (p._sum.amount || 0), 0);

    return {
      period: { start: startDate, end: endDate },
      total,
      methods: paymentsByMethod.map(m => ({
        method: m.method,
        total: m._sum.amount || 0,
        count: m._count,
        percentage: total > 0 ? Number(((m._sum.amount || 0) / total * 100).toFixed(2)) : 0,
      })).sort((a, b) => b.total - a.total),
    };
  }

  /**
   * Serviços Mais Lucrativos
   */
  async getMostProfitableServices(startDate: Date, endDate: Date) {
    // Buscar agendamentos pagos do período
    const appointments = await prisma.appointment.findMany({
      where: {
        status: 'COMPLETED',
        isPaid: true,
        createdAt: { gte: startDate, lte: endDate },
      },
      select: {
        services: true,
        totalAmount: true,
      },
    });

    // Processar serviços
    const servicesMap = new Map<string, { 
      name: string; 
      count: number; 
      revenue: number; 
      price: number 
    }>();

    appointments.forEach(apt => {
      const services = apt.services as any[];
      services.forEach(svc => {
        const existing = servicesMap.get(svc.id) || { 
          name: svc.name, 
          count: 0, 
          revenue: 0, 
          price: svc.price 
        };
        existing.count += 1;
        existing.revenue += svc.price;
        servicesMap.set(svc.id, existing);
      });
    });

    const servicesArray = Array.from(servicesMap.entries()).map(([id, data]) => ({
      serviceId: id,
      serviceName: data.name,
      totalRevenue: data.revenue,
      timesBooked: data.count,
      averagePrice: data.price,
    })).sort((a, b) => b.totalRevenue - a.totalRevenue);

    const totalRevenue = servicesArray.reduce((sum, s) => sum + s.totalRevenue, 0);

    return {
      period: { start: startDate, end: endDate },
      totalRevenue,
      services: servicesArray.map(s => ({
        ...s,
        percentage: totalRevenue > 0 ? Number((s.totalRevenue / totalRevenue * 100).toFixed(2)) : 0,
      })),
    };
  }

  /**
   * Relatório Financeiro Completo
   */
  async getFinancialComplete(startDate: Date, endDate: Date) {
    const [revenueByPeriod, revenueByMethod, profitableServices, commissions] = await Promise.all([
      this.getRevenueByPeriod(startDate, endDate),
      this.getRevenueByPaymentMethod(startDate, endDate),
      this.getMostProfitableServices(startDate, endDate),
      prisma.commission.aggregate({
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      summary: {
        revenue: revenueByPeriod.current.revenue,
        expenses: revenueByPeriod.current.expenses,
        profit: revenueByPeriod.current.profit,
        commissions: commissions._sum.amount || 0,
        netProfit: revenueByPeriod.current.profit - (commissions._sum.amount || 0),
      },
      revenueByPeriod,
      revenueByMethod,
      profitableServices,
      commissions: {
        total: commissions._sum.amount || 0,
        count: commissions._count,
      },
    };
  }

  // =============================================
  // RELATÓRIOS DE AGENDAMENTOS
  // =============================================

  /**
   * Estatísticas de Agendamentos
   */
  async getAppointmentsStats(startDate: Date, endDate: Date) {
    const [statusStats, hourlyDistribution, staffPerformance] = await Promise.all([
      // Agendamentos por status
      prisma.appointment.groupBy({
        by: ['status'],
        where: {
          startTime: { gte: startDate, lte: endDate },
        },
        _count: true,
      }),
      // Distribuição por hora
      prisma.$queryRaw<Array<{hour: number, count: number}>>`
        SELECT 
          EXTRACT(HOUR FROM start_time)::int as hour,
          COUNT(*)::int as count
        FROM appointments
        WHERE start_time >= ${startDate}
        AND start_time <= ${endDate}
        GROUP BY EXTRACT(HOUR FROM start_time)
        ORDER BY hour
      `,
      // Performance por profissional
      prisma.appointment.groupBy({
        by: ['staffId'],
        where: {
          startTime: { gte: startDate, lte: endDate },
          status: { in: ['COMPLETED', 'CONFIRMED', 'IN_PROGRESS'] },
        },
        _count: true,
        _sum: {
          totalAmount: true,
        },
      }),
    ]);

    const total = statusStats.reduce((sum, s) => sum + s._count, 0);
    const completed = statusStats.find(s => s.status === 'COMPLETED')?._count || 0;
    const cancelled = statusStats.find(s => s.status === 'CANCELLED')?._count || 0;
    const noShow = statusStats.find(s => s.status === 'NO_SHOW')?._count || 0;

    // Buscar detalhes dos profissionais
    const staffIds = staffPerformance.map(s => s.staffId);
    const staffDetails = await prisma.staff.findMany({
      where: { id: { in: staffIds } },
      include: {
        user: { select: { name: true } },
      },
    });

    const staffWithDetails = staffPerformance.map(perf => {
      const staff = staffDetails.find(s => s.id === perf.staffId);
      return {
        staffId: perf.staffId,
        staffName: staff?.user.name || 'Desconhecido',
        appointmentsCount: perf._count,
        totalRevenue: perf._sum.totalAmount || 0,
        averageTicket: perf._count > 0 ? (perf._sum.totalAmount || 0) / perf._count : 0,
      };
    }).sort((a, b) => b.totalRevenue - a.totalRevenue);

    return {
      period: { start: startDate, end: endDate },
      summary: {
        total,
        completed,
        cancelled,
        noShow,
        completionRate: total > 0 ? Number(((completed / total) * 100).toFixed(2)) : 0,
        cancellationRate: total > 0 ? Number((((cancelled + noShow) / total) * 100).toFixed(2)) : 0,
      },
      byStatus: statusStats.map(s => ({
        status: s.status,
        count: s._count,
        percentage: total > 0 ? Number((s._count / total * 100).toFixed(2)) : 0,
      })),
      byHour: hourlyDistribution.map(h => ({
        hour: h.hour,
        count: h.count,
      })),
      byStaff: staffWithDetails,
    };
  }

  /**
   * Taxa de Ocupação
   */
  async getOccupancyRate(startDate: Date, endDate: Date) {
    const staff = await prisma.staff.findMany({
      where: { isAvailable: true },
      include: {
        user: { select: { name: true } },
        appointments: {
          where: {
            startTime: { gte: startDate, lte: endDate },
            status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          },
          select: {
            startTime: true,
            endTime: true,
          },
        },
      },
    });

    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const workHoursPerDay = 9; // 9h às 18h = 9 horas
    const totalAvailableHours = days * workHoursPerDay;

    const occupancyByStaff = staff.map(s => {
      const totalMinutes = s.appointments.reduce((sum, apt) => {
        const duration = (apt.endTime.getTime() - apt.startTime.getTime()) / (1000 * 60);
        return sum + duration;
      }, 0);
      const occupiedHours = totalMinutes / 60;
      const occupancyRate = (occupiedHours / totalAvailableHours) * 100;

      return {
        staffId: s.id,
        staffName: s.user.name,
        appointmentsCount: s.appointments.length,
        occupiedHours: Number(occupiedHours.toFixed(2)),
        availableHours: totalAvailableHours,
        occupancyRate: Number(occupancyRate.toFixed(2)),
      };
    });

    const overallOccupancy = occupancyByStaff.reduce((sum, s) => sum + s.occupancyRate, 0) / staff.length;

    return {
      period: { start: startDate, end: endDate, days },
      overall: {
        totalStaff: staff.length,
        averageOccupancy: Number(overallOccupancy.toFixed(2)),
        totalAvailableHours: totalAvailableHours * staff.length,
      },
      byStaff: occupancyByStaff.sort((a, b) => b.occupancyRate - a.occupancyRate),
    };
  }

  // =============================================
  // RELATÓRIOS DE PRODUTOS
  // =============================================

  /**
   * Produtos Mais Vendidos
   */
  async getTopSellingProducts(startDate: Date, endDate: Date) {
    const sales = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: {
          createdAt: { gte: startDate, lte: endDate },
          paymentStatus: 'PAID',
        },
      },
      _sum: {
        quantity: true,
        total: true,
      },
      _count: true,
    });

    const productIds = sales.map(s => s.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        name: true,
        category: true,
        costPrice: true,
        salePrice: true,
      },
    });

    const productsWithSales = sales.map(sale => {
      const product = products.find(p => p.id === sale.productId);
      const quantity = sale._sum.quantity || 0;
      const revenue = sale._sum.total || 0;
      const cost = product ? product.costPrice * quantity : 0;
      const profit = revenue - cost;

      return {
        productId: sale.productId,
        productName: product?.name || 'Produto Desconhecido',
        category: product?.category || 'Sem Categoria',
        quantitySold: quantity,
        revenue,
        cost,
        profit,
        profitMargin: revenue > 0 ? Number(((profit / revenue) * 100).toFixed(2)) : 0,
        timesOrdered: sale._count,
      };
    }).sort((a, b) => b.revenue - a.revenue);

    const totalRevenue = productsWithSales.reduce((sum, p) => sum + p.revenue, 0);

    return {
      period: { start: startDate, end: endDate },
      summary: {
        totalRevenue,
        totalProfit: productsWithSales.reduce((sum, p) => sum + p.profit, 0),
        totalItemsSold: productsWithSales.reduce((sum, p) => sum + p.quantitySold, 0),
      },
      products: productsWithSales.map(p => ({
        ...p,
        revenuePercentage: totalRevenue > 0 ? Number((p.revenue / totalRevenue * 100).toFixed(2)) : 0,
      })),
    };
  }

  /**
   * Estoque Crítico
   */
  async getLowStockProducts() {
    // Buscar todos os produtos ativos
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        sku: true,
        name: true,
        category: true,
        quantity: true,
        reorderThreshold: true,
        supplier: true,
        costPrice: true,
        salePrice: true,
      },
      orderBy: {
        quantity: 'asc',
      },
    });

    // Filtrar produtos com estoque baixo ou zerado
    const filteredProducts = products.filter(p => p.quantity <= p.reorderThreshold);

    const criticalCount = filteredProducts.filter(p => p.quantity === 0).length;
    const lowStockCount = filteredProducts.filter(p => p.quantity > 0 && p.quantity <= p.reorderThreshold).length;

    return {
      summary: {
        total: filteredProducts.length,
        critical: criticalCount,
        lowStock: lowStockCount,
      },
      products: filteredProducts.map(p => ({
        ...p,
        status: p.quantity === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
        reorderQuantity: Math.max(p.reorderThreshold * 2 - p.quantity, 0),
      })),
    };
  }

  /**
   * Análise de Movimentação de Estoque
   */
  async getStockMovementAnalysis(startDate: Date, endDate: Date) {
    const movements = await prisma.stockMovement.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            category: true,
            costPrice: true,
          },
        },
      },
    });

    const byType = movements.reduce((acc, m) => {
      if (!acc[m.type]) {
        acc[m.type] = { count: 0, quantity: 0, value: 0 };
      }
      acc[m.type].count++;
      acc[m.type].quantity += Math.abs(m.quantity);
      acc[m.type].value += Math.abs(m.quantity) * m.product.costPrice;
      return acc;
    }, {} as Record<string, { count: number; quantity: number; value: number }>);

    const byProduct = movements.reduce((acc, m) => {
      const key = m.productId;
      if (!acc[key]) {
        acc[key] = {
          productId: m.productId,
          productName: m.product.name,
          category: m.product.category,
          in: 0,
          out: 0,
          adjustment: 0,
        };
      }
      if (m.type === 'IN') acc[key].in += m.quantity;
      else if (m.type === 'OUT') acc[key].out += Math.abs(m.quantity);
      else if (m.type === 'ADJUSTMENT') acc[key].adjustment += m.quantity;
      return acc;
    }, {} as Record<string, any>);

    return {
      period: { start: startDate, end: endDate },
      summary: {
        totalMovements: movements.length,
        byType,
      },
      byProduct: Object.values(byProduct),
    };
  }

  // =============================================
  // RELATÓRIOS DE CLIENTES
  // =============================================

  /**
   * Análise de Clientes
   */
  async getClientsAnalysis(startDate: Date, endDate: Date) {
    const [newClients, totalClients, clientsWithAppointments, topClients] = await Promise.all([
      // Novos clientes no período
      prisma.client.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
      }),
      // Total de clientes
      prisma.client.count(),
      // Clientes ativos (com agendamentos no período)
      prisma.client.count({
        where: {
          appointments: {
            some: {
              startTime: { gte: startDate, lte: endDate },
              status: { in: ['COMPLETED', 'CONFIRMED', 'IN_PROGRESS'] },
            },
          },
        },
      }),
      // Top clientes por receita
      prisma.payment.groupBy({
        by: ['clientId'],
        where: {
          status: 'PAID',
          paidAt: { gte: startDate, lte: endDate },
        },
        _sum: {
          amount: true,
        },
        _count: true,
        orderBy: {
          _sum: {
            amount: 'desc',
          },
        },
        take: 10,
      }),
    ]);

    // Buscar detalhes dos top clientes
    const clientIds = topClients.map(c => c.clientId);
    const clientDetails = await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        loyaltyPoints: true,
      },
    });

    const topClientsWithDetails = topClients.map(tc => {
      const client = clientDetails.find(c => c.id === tc.clientId);
      return {
        clientId: tc.clientId,
        clientName: client?.name || 'Desconhecido',
        clientPhone: client?.phone || '',
        totalSpent: tc._sum.amount || 0,
        transactionCount: tc._count,
        loyaltyPoints: client?.loyaltyPoints || 0,
        averageTicket: tc._count > 0 ? (tc._sum.amount || 0) / tc._count : 0,
      };
    });

    const retentionRate = totalClients > 0 ? (clientsWithAppointments / totalClients) * 100 : 0;

    return {
      period: { start: startDate, end: endDate },
      summary: {
        total: totalClients,
        new: newClients,
        active: clientsWithAppointments,
        inactive: totalClients - clientsWithAppointments,
        retentionRate: Number(retentionRate.toFixed(2)),
      },
      topClients: topClientsWithDetails,
    };
  }

  /**
   * Clientes Inativos para Reativação
   */
  async getInactiveClients(daysInactive: number = 60) {
    const inactiveDate = new Date();
    inactiveDate.setDate(inactiveDate.getDate() - daysInactive);

    const inactiveClients = await prisma.client.findMany({
      where: {
        isBlocked: false,
        appointments: {
          none: {
            startTime: { gte: inactiveDate },
          },
        },
      },
      include: {
        appointments: {
          orderBy: { startTime: 'desc' },
          take: 1,
          select: {
            startTime: true,
            services: true,
            totalAmount: true,
          },
        },
        payments: {
          where: { status: 'PAID' },
          select: {
            amount: true,
          },
        },
      },
    });

    const clientsWithStats = inactiveClients.map(client => {
      const lastAppointment = client.appointments[0];
      const totalSpent = client.payments.reduce((sum, p) => sum + p.amount, 0);
      const daysSinceLastVisit = lastAppointment 
        ? Math.floor((Date.now() - lastAppointment.startTime.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        clientId: client.id,
        name: client.name,
        phone: client.phone,
        email: client.email,
        lastVisit: lastAppointment?.startTime || null,
        daysSinceLastVisit,
        totalSpent,
        appointmentsCount: client.appointments.length,
        loyaltyPoints: client.loyaltyPoints,
      };
    }).sort((a, b) => b.totalSpent - a.totalSpent);

    return {
      daysInactive,
      summary: {
        total: clientsWithStats.length,
        potentialRevenue: clientsWithStats.reduce((sum, c) => sum + c.totalSpent, 0) / 
          (clientsWithStats.filter(c => c.appointmentsCount > 0).length || 1),
      },
      clients: clientsWithStats,
    };
  }

  /**
   * Análise de Fidelidade
   */
  async getLoyaltyAnalysis() {
    const clients = await prisma.client.findMany({
      where: {
        loyaltyPoints: { gt: 0 },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        loyaltyPoints: true,
        createdAt: true,
        _count: {
          select: {
            appointments: true,
          },
        },
      },
      orderBy: {
        loyaltyPoints: 'desc',
      },
      take: 50,
    });

    const totalPoints = await prisma.client.aggregate({
      _sum: { loyaltyPoints: true },
    });

    return {
      summary: {
        totalPointsInCirculation: totalPoints._sum.loyaltyPoints || 0,
        clientsWithPoints: clients.length,
      },
      topLoyalClients: clients.map(c => ({
        clientId: c.id,
        name: c.name,
        phone: c.phone,
        points: c.loyaltyPoints,
        appointmentsCount: c._count.appointments,
        memberSince: c.createdAt,
      })),
    };
  }

  // =============================================
  // COMISSÕES (Mantido do código original)
  // =============================================
  
  async getCommissions(staffId?: string, startDate?: Date, endDate?: Date) {
    const where: any = {};
    if (staffId) where.staffId = staffId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const commissions = await prisma.commission.findMany({
      where,
      include: {
        staff: {
          include: {
            user: { select: { name: true } },
          },
        },
        payment: {
          include: {
            appointment: { select: { startTime: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const total = commissions.reduce((sum, c) => sum + c.amount, 0);
    const paid = commissions.filter(c => c.isPaid).reduce((sum, c) => sum + c.amount, 0);

    return {
      commissions,
      summary: { total, paid, pending: total - paid },
    };
  }
}
