/**
 * Verificação das notificações expandidas.
 * Rodar: cd backend; npx tsx scripts/verify-notifications.ts
 *
 * Script de validação (gate TDD deste projeto): cria dados de teste,
 * confere o comportamento e **auto-limpa** o banco no final.
 */
import { PrismaClient } from '@prisma/client';
import { NotificationType } from '@prisma/client';
import * as notificationsModule from '../src/api/v1/notifications/notifications.service';
import { runAppointmentStartReconcile } from '../src/jobs/appointment-start';

const API = 'http://localhost:4000/api/v1';
const prisma = new PrismaClient();
const COMPANY_NAME = process.env.FINANCE_COMPANY_NAME || 'Empresa padrão';

/** 0B.1: fail-closed — sem empresa resolvida, nenhum delete roda. */
async function tenantId(): Promise<string> {
  const company = await prisma.company.findFirst({ where: { name: COMPANY_NAME } });
  if (!company) throw new Error(`[cleanup] Empresa "${COMPANY_NAME}" não encontrada — abortando.`);
  return company.id;
}

const results: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  const token = body?.data?.accessToken;
  if (!token) throw new Error(`login falhou para ${email}: ${JSON.stringify(body)}`);
  return token;
}

async function req(path: string, token: string, options: RequestInit = {}) {
  const res = await fetch(`${API}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body as BodyInit | undefined,
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function listNotifications(token: string): Promise<any[]> {
  const res = await req('/notifications?page=1&limit=100', token);
  return res.body?.data?.notifications ?? [];
}

// 0B.1: sem `as any` — assinatura real exige companyId (3º arg).
const notifyResource = notificationsModule.notifyResource;

// IDs criados pelo teste — removidos no final.
const cleanup = {
  notifications: [] as string[],
  users: [] as string[],
  staff: [] as string[],
  products: [] as string[],
  appointments: [] as string[],
  payments: [] as string[],
  clients: [] as string[],
  // Marcadores textuais do teste, TIPADOS: (tipo da notificação, texto).
  // Necessários porque `notifyRoles(['Admin'])` notifica TODOS os admins
  // ativos (o seed tem 2), mas `GET /notifications` lista só as do admin
  // logado — a linha do outro admin nunca entra por id e vazava a cada run.
  // O par (tipo, texto) impede que o cleanup apague notificação legítima
  // que por acaso cite o mesmo texto (fix do achado BAIXA do review).
  markers: [] as { type: NotificationType; text: string }[],
};

async function cleanupAll() {
  const counts: Record<string, number> = {};
  const cid = await tenantId();

  if (cleanup.notifications.length) {
    const r = await prisma.notification.deleteMany({
      where: { companyId: cid, id: { in: cleanup.notifications } },
    });
    counts.notifications = r.count;
  }

  // Notificações cujo `message` cita o dado de teste — cobre o destinatário
  // que o gate não enxerga (2º admin do seed): o cleanup por id só pega a
  // linha do admin logado, a do outro admin vaza a cada execução.
  // Restrito por TIPO + marcador único: uma notificação legítima que cite
  // "Verify Notif" (ou o nome de um produto de teste) não é apagada.
  if (cleanup.markers.length) {
    const r = await prisma.notification.deleteMany({
      where: {
        companyId: cid,
        OR: cleanup.markers.map((m) => ({
          type: m.type,
          message: { contains: m.text },
        })),
      },
    });
    counts.notificationsPorMensagem = r.count;
  }

  // Notificações cujo único vínculo com o teste é o `link` (NEW_PRODUCT,
  // LOW_STOCK, CONFIRMATION, NEW_STAFF...) não são coletadas por id em
  // todos os caminhos — sem isso, sobram notificações órfãs apontando
  // para produtos/agendamentos já deletados.
  const testLinks = [
    ...cleanup.products.map((id) => `/products/${id}`),
    ...cleanup.staff.map((id) => `/staff/${id}`),
    ...cleanup.appointments.map((id) => `/appointments/${id}`),
  ];
  if (testLinks.length || cleanup.appointments.length) {
    const r = await prisma.notification.deleteMany({
      where: {
        companyId: cid,
        OR: [
          ...(testLinks.length ? [{ link: { in: testLinks } }] : []),
          ...(cleanup.appointments.length
            ? [{ appointmentId: { in: cleanup.appointments } }]
            : []),
        ],
      },
    });
    counts.notificationsOrfas = r.count;
  }

  if (cleanup.appointments.length) {
    // Pagamentos dos agendamentos do teste (inclusive o PENDING criado
    // automaticamente) — apagados ANTES dos agendamentos, senão o FK
    // ON DELETE SET NULL deixa pagamento órfão no banco.
    const paymentsOfTest = await prisma.payment.findMany({
      where: { companyId: cid, appointmentId: { in: cleanup.appointments } },
      select: { id: true },
    });
    const ids = paymentsOfTest.map((p) => p.id);
    if (ids.length) {
      const commissions = await prisma.commission.deleteMany({
        where: { companyId: cid, paymentId: { in: ids } },
      });
      counts.commissions = (counts.commissions ?? 0) + commissions.count;
      const r = await prisma.payment.deleteMany({ where: { companyId: cid, id: { in: ids } } });
      counts.payments = (counts.payments ?? 0) + r.count;
    }

    // Jobs BullMQ dos agendamentos do teste (job atrasado no Redis é lixo)
    try {
      const { notificationQueue, appointmentStartJobId } = await import('../src/jobs/queue');
      const appointments = await prisma.appointment.findMany({
        where: { companyId: cid, id: { in: cleanup.appointments } },
        select: { id: true, startTime: true },
      });
      let removed = 0;
      for (const appointment of appointments) {
        const job = await notificationQueue.getJob(
          appointmentStartJobId(appointment.id, appointment.startTime)
        );
        if (!job) continue;
        await job.remove();
        removed += 1;
      }
      counts.jobs = removed;
    } catch (error: any) {
      counts.jobs = `erro: ${error?.message ?? 'fila indisponível'}`;
    }
  }

  if (cleanup.payments.length) {
    const commissions = await prisma.commission.deleteMany({
      where: { companyId: cid, paymentId: { in: cleanup.payments } },
    });
    counts.commissions = commissions.count;
    const r = await prisma.payment.deleteMany({ where: { companyId: cid, id: { in: cleanup.payments } } });
    counts.payments = r.count;
  }
  if (cleanup.appointments.length) {
    const r = await prisma.appointment.deleteMany({
      where: { companyId: cid, id: { in: cleanup.appointments } },
    });
    counts.appointments = r.count;
  }
  if (cleanup.staff.length) {
    const r = await prisma.staff.deleteMany({ where: { companyId: cid, id: { in: cleanup.staff } } });
    counts.staff = r.count;
  }
  if (cleanup.products.length) {
    // stock_movements referencia products com RESTRICT — remover antes
    const movements = await prisma.stockMovement.deleteMany({
      where: { companyId: cid, productId: { in: cleanup.products } },
    });
    counts.stockMovements = movements.count;
    const r = await prisma.product.deleteMany({
      where: { companyId: cid, id: { in: cleanup.products } },
    });
    counts.products = r.count;
  }
  if (cleanup.users.length) {
    const r = await prisma.user.deleteMany({ where: { companyId: cid, id: { in: cleanup.users } } });
    counts.users = r.count;
  }
  if (cleanup.clients.length) {
    const r = await prisma.client.deleteMany({ where: { companyId: cid, id: { in: cleanup.clients } } });
    counts.clients = r.count;
  }

  console.log('LIMPEZA:', JSON.stringify(counts));
}

(async () => {
  try {
    const admin = await login('admin@salao.com', 'admin123');
    const recepcao = await login('recepcao@salao.com', 'reception123');
    const cid = await tenantId();

    // ------------------------------------------------------------- Task 2
    check(
      'serviço expõe notifyResource',
      typeof notifyResource === 'function',
      typeof notifyResource === 'function' ? '' : 'notifyResource ausente'
    );

    if (typeof notifyResource === 'function') {
      const message = 'Teste verify-notifications: link';
      const dedupeKey = `VERIFY:${Date.now()}`;

      await notifyResource(
        {
          type: NotificationType.NEW_PRODUCT,
          message,
          link: '/products/verify-teste',
          dedupeKey,
        },
        { roleNames: ['Admin'] },
        cid
      );

      const list = await listNotifications(admin);
      const created = list.find((n: any) => n.message === message);

      check(
        'notificação criada com link no payload da API',
        created?.link === '/products/verify-teste',
        `link=${created?.link}`
      );

      // Dedupe: mesmo dedupeKey não pode duplicar para o mesmo usuário
      await notifyResource(
        {
          type: NotificationType.NEW_PRODUCT,
          message,
          link: '/products/verify-teste',
          dedupeKey,
        },
        { roleNames: ['Admin'] },
        cid
      );

      const list2 = await listNotifications(admin);
      const duplicates = list2.filter((n: any) => n.message === message);
      check('dedupe impede duplicata para o mesmo usuário', duplicates.length === 1, `itens=${duplicates.length}`);

      // Limpeza do dado de teste do Task 2
      const deleted = await prisma.notification.deleteMany({
        where: { companyId: await tenantId(), message },
      });
      check('limpeza remove notificação de teste', deleted.count > 0, `removidos=${deleted.count}`);
    }

    // ------------------------------------------------------------- Task 3
    const stamp = Date.now();
    const email = `verify.user.${stamp}@teste.local`;
    // Nome ÚNICO do fixture (stamp) — o marcador 'Usuário Verify' era
    // genérico e podia casar com notificação legítima de outro contexto.
    const testUserName = `Verify Notif ${stamp}`;
    // Marcadores de cleanup: e-mail do usuário de teste (NEW_USER) e nome do
    // fixture (NEW_STAFF) — tipados, para não apagar homônimos legítimos.
    cleanup.markers.push(
      { type: NotificationType.NEW_USER, text: email },
      { type: NotificationType.NEW_STAFF, text: testUserName }
    );

    // Cargo: POST /staff aceita qualquer cargo em usuário ativo (regra do backend)
    const rolesRes = await req('/roles', admin);
    const roles = Array.isArray(rolesRes.body?.data) ? rolesRes.body.data : [];
    const profissionalRoleId = roles.find((r: any) => r.name === 'Profissional')?.id;
    check(
      'cargo Profissional disponível para o usuário de teste',
      !!profissionalRoleId,
      `roleId=${profissionalRoleId ?? 'n/a'}`
    );
    // Staff de teste (sempre sem appointments) — usado pelo Task 6 para não
    // colidir com slots de staff real do seed.
    let verifyStaffId: string | undefined;
    let verifyEmail: string | null = null;

    const createdUser = await req('/users', admin, {
      method: 'POST',
      body: JSON.stringify({
        email,
        password: 'verify123',
        name: testUserName,
        // POST /staff exige usuário ativo com cargo (regra do backend)
        roleId: profissionalRoleId,
      }),
    });
    const userId = createdUser.body?.data?.user?.id;

    check(
      'POST /users cria usuário',
      createdUser.status < 300 && !!userId,
      `status=${createdUser.status} id=${userId ?? 'n/a'}`
    );

    if (userId) {
      cleanup.users.push(userId);
      const adminList = await listNotifications(admin);
      const newUser = adminList.find(
        (n: any) => n.type === NotificationType.NEW_USER && n.message.includes(email)
      );
      check(
        'novo usuário gera NEW_USER para Admin',
        !!newUser,
        newUser ? `id=${newUser.id}` : 'notificação não encontrada'
      );
      check(
        'NEW_USER tem link /staff',
        newUser?.link === '/staff',
        `link=${newUser?.link}`
      );
      if (newUser) cleanup.notifications.push(newUser.id);

      const recepcaoList = await listNotifications(recepcao);
      const leaked = recepcaoList.find(
        (n: any) => n.type === NotificationType.NEW_USER && n.message.includes(email)
      );
      check(
        'NEW_USER não é enviada para Recepção',
        !leaked,
        leaked ? `vazou id=${leaked.id}` : 'ok'
      );

      // --- Novo profissional (staff) a partir do usuário criado
      const createdStaff = await req('/staff', admin, {
        method: 'POST',
        body: JSON.stringify({ userId, specialties: ['Cabelo'] }),
      });
      const staffId = createdStaff.body?.data?.staff?.id;
      if (staffId) verifyStaffId = staffId;
      verifyEmail = email;

      check(
        'POST /staff cria profissional',
        createdStaff.status < 300 && !!staffId,
        `status=${createdStaff.status} id=${staffId ?? 'n/a'}`
      );

      if (staffId) {
        cleanup.staff.push(staffId);
        const adminList2 = await listNotifications(admin);
        const newStaff = adminList2.find(
          (n: any) => n.type === NotificationType.NEW_STAFF && n.message.includes(testUserName)
        );
        check(
          'novo profissional gera NEW_STAFF para Admin',
          !!newStaff,
          newStaff ? `id=${newStaff.id}` : 'notificação não encontrada'
        );
        check(
          'NEW_STAFF tem link /staff/{id}',
          newStaff?.link === `/staff/${staffId}`,
          `link=${newStaff?.link} esperado=/staff/${staffId}`
        );
        if (newStaff) cleanup.notifications.push(newStaff.id);

        const recepcaoList2 = await listNotifications(recepcao);
        const leakedStaff = recepcaoList2.find(
          (n: any) => n.type === NotificationType.NEW_STAFF && n.message.includes(testUserName)
        );
        check(
          'NEW_STAFF não é enviada para Recepção',
          !leakedStaff,
          leakedStaff ? `vazou id=${leakedStaff.id}` : 'ok'
        );
      }
    }

    // ------------------------------------------------------------- Task 4
    const productName = `Produto Verify ${stamp}`;
    const productSku = `SKU-VERIFY-${stamp}`;
    cleanup.markers.push({ type: NotificationType.NEW_PRODUCT, text: productName });

    const createdProduct = await req('/products', admin, {
      method: 'POST',
      body: JSON.stringify({
        sku: productSku,
        name: productName,
        category: 'Teste',
        quantity: 20,
        costPrice: 10,
        salePrice: 20,
        reorderThreshold: 10,
      }),
    });
    const productId = createdProduct.body?.data?.product?.id;

    check(
      'POST /products cria produto',
      createdProduct.status < 300 && !!productId,
      `status=${createdProduct.status} id=${productId ?? 'n/a'}`
    );

    if (productId) {
      cleanup.products.push(productId);

      const adminList = await listNotifications(admin);
      const newProduct = adminList.find(
        (n: any) => n.type === NotificationType.NEW_PRODUCT && n.message.includes(productName)
      );
      check(
        'novo produto gera NEW_PRODUCT para Admin',
        !!newProduct,
        newProduct ? `id=${newProduct.id}` : 'notificação não encontrada'
      );
      check(
        'NEW_PRODUCT tem link /products/{id}',
        newProduct?.link === `/products/${productId}`,
        `link=${newProduct?.link}`
      );
      if (newProduct) cleanup.notifications.push(newProduct.id);

      const recepcaoList = await listNotifications(recepcao);
      const newProductRecepcao = recepcaoList.find(
        (n: any) => n.type === NotificationType.NEW_PRODUCT && n.message.includes(productName)
      );
      check(
        'novo produto gera NEW_PRODUCT para Recepção',
        !!newProductRecepcao,
        newProductRecepcao ? `id=${newProductRecepcao.id}` : 'notificação não encontrada'
      );
      if (newProductRecepcao) cleanup.notifications.push(newProductRecepcao.id);

      const lowStockBefore = adminList.filter(
        (n: any) => n.type === NotificationType.LOW_STOCK && n.message.includes(productName)
      );
      check(
        'produto acima do limite não gera LOW_STOCK',
        lowStockBefore.length === 0,
        `itens=${lowStockBefore.length}`
      );

      // Travessia do limiar: 20 -> 10 (limite 10) dispara
      const removed = await req(`/products/${productId}/stock/remove`, admin, {
        method: 'POST',
        body: JSON.stringify({ quantity: 10, reason: 'verify' }),
      });
      check(
        'POST /products/{id}/stock/remove remove estoque',
        removed.status < 300,
        `status=${removed.status}`
      );

      const afterCross = await listNotifications(admin);
      const lowStock = afterCross.filter(
        (n: any) => n.type === NotificationType.LOW_STOCK && n.message.includes(productName)
      );
      check(
        'estoque cruzando o limite gera LOW_STOCK (1x)',
        lowStock.length === 1,
        `itens=${lowStock.length}`
      );
      check(
        'LOW_STOCK tem link /products/{id}',
        lowStock[0]?.link === `/products/${productId}`,
        `link=${lowStock[0]?.link}`
      );
      lowStock.forEach((n: any) => cleanup.notifications.push(n.id));

      const recepcaoLow = (await listNotifications(recepcao)).filter(
        (n: any) => n.type === NotificationType.LOW_STOCK && n.message.includes(productName)
      );
      check(
        'LOW_STOCK também chega para Recepção',
        recepcaoLow.length === 1,
        `itens=${recepcaoLow.length}`
      );
      recepcaoLow.forEach((n: any) => cleanup.notifications.push(n.id));

      // Reposição não notifica
      await req(`/products/${productId}/stock/add`, admin, {
        method: 'POST',
        body: JSON.stringify({ quantity: 50, reason: 'verify' }),
      });
      const afterRestock = await listNotifications(admin);
      const lowStockAfterRestock = afterRestock.filter(
        (n: any) => n.type === NotificationType.LOW_STOCK && n.message.includes(productName)
      );
      check(
        'reposição de estoque não gera LOW_STOCK',
        lowStockAfterRestock.length === 1,
        `itens=${lowStockAfterRestock.length}`
      );

      // Nova travessia gera novo aviso (dedupeKey inclui o evento, não só o produto)
      await req(`/products/${productId}/stock/remove`, admin, {
        method: 'POST',
        body: JSON.stringify({ quantity: 50, reason: 'verify' }),
      });
      const afterSecondCross = await listNotifications(admin);
      const lowStockSecond = afterSecondCross.filter(
        (n: any) => n.type === NotificationType.LOW_STOCK && n.message.includes(productName)
      );
      check(
        'nova travessia do limite gera novo LOW_STOCK',
        lowStockSecond.length === 2,
        `itens=${lowStockSecond.length}`
      );
      lowStockSecond.forEach((n: any) => {
        if (!cleanup.notifications.includes(n.id)) cleanup.notifications.push(n.id);
      });

      // Produto criado já abaixo do limite
      const lowName = `Produto Baixo ${stamp}`;
      cleanup.markers.push({ type: NotificationType.LOW_STOCK, text: lowName });
      const lowProduct = await req('/products', admin, {
        method: 'POST',
        body: JSON.stringify({
          sku: `SKU-BAIXO-${stamp}`,
          name: lowName,
          category: 'Teste',
          quantity: 5,
          costPrice: 10,
          salePrice: 20,
          reorderThreshold: 10,
        }),
      });
      const lowProductId = lowProduct.body?.data?.product?.id;
      if (lowProductId) {
        cleanup.products.push(lowProductId);
        const lowList = await listNotifications(admin);
        const lowCreated = lowList.filter(
          (n: any) => n.type === NotificationType.LOW_STOCK && n.message.includes(lowName)
        );
        check(
          'produto criado abaixo do limite gera LOW_STOCK',
          lowCreated.length === 1,
          `itens=${lowCreated.length}`
        );
        lowCreated.forEach((n: any) => cleanup.notifications.push(n.id));
      }
    }

    // ------------------------------------------------------------- Task 5
    const mariaStaff = await prisma.staff.findFirst({
      where: { companyId: cid, user: { email: 'maria@salao.com' } },
      select: { id: true },
    });
    const testClient = await prisma.client.findFirst({
      where: { companyId: cid, isBlocked: false },
      select: { id: true, name: true },
    });
    const testService = await prisma.service.findFirst({ where: { companyId: cid } });

    if (mariaStaff && testClient && testService) {
      // Slot livre: tenta horários/dias até um agendamento ser aceito.
      // Slot fixo colide com execuções anteriores (e com o seed) e o gate
      // falha por motivo errado.
      let createdAppt: any = null;
      let appointmentId: string | undefined;
      let appointmentStart: Date | undefined;

      outer: for (const dayOffset of [3, 4, 5, 6]) {
        for (const hour of [10, 11, 12, 13, 14, 15, 16, 17, 18]) {
          const candidate = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
          candidate.setHours(hour, 0, 0, 0);

          const res = await req('/appointments', admin, {
            method: 'POST',
            body: JSON.stringify({
              clientId: testClient.id,
              staffId: mariaStaff.id,
              startTime: candidate.toISOString(),
              services: [
                {
                  id: testService.id,
                  name: testService.name,
                  price: testService.price,
                  duration: testService.durationMinutes,
                },
              ],
            }),
          });

          if (res.status < 300) {
            createdAppt = res;
            appointmentId = res.body?.data?.appointment?.id;
            appointmentStart = candidate;
            break outer;
          }
        }
      }

      check(
        'POST /appointments cria agendamento',
        !!appointmentId,
        `status=${createdAppt?.status ?? 'n/a'} id=${appointmentId ?? 'n/a'} msg=${createdAppt?.body?.message ?? createdAppt?.body?.error ?? ''}`
      );

      if (appointmentId) {
        cleanup.appointments.push(appointmentId);

        // Antes de finalizar: NÃO pode existir PAYMENT_PENDING (o requisito é
        // notificar pendência só na finalização).
        const beforeComplete = await listNotifications(admin);
        const pendingBeforeComplete = beforeComplete.filter(
          (n: any) =>
            n.type === NotificationType.PAYMENT_PENDING &&
            n.link === `/appointments/${appointmentId}`
        );
        check(
          'PAYMENT_PENDING não existe antes da finalização',
          pendingBeforeComplete.length === 0,
          `itens=${pendingBeforeComplete.length}`
        );

        // Finalizar sem pagamento → PAYMENT_PENDING
        const completed = await req(`/appointments/${appointmentId}`, admin, {
          method: 'PUT',
          body: JSON.stringify({ status: 'COMPLETED' }),
        });
        check(
          'PUT /appointments/:id completa agendamento',
          completed.status < 300,
          `status=${completed.status}`
        );

        const adminList = await listNotifications(admin);
        const pending = adminList.find(
          (n: any) =>
            n.type === NotificationType.PAYMENT_PENDING &&
            n.link === `/appointments/${appointmentId}`
        );
        check(
          'agendamento concluído sem pagamento gera PAYMENT_PENDING',
          !!pending,
          pending ? `id=${pending.id}` : 'notificação não encontrada'
        );
        check(
          'mensagem de pagamento pendente tem o texto do Jonathas',
          !!pending &&
            pending.message.startsWith(`Pagamento do agendamento de ${testClient.name} (`) &&
            pending.message.endsWith(') com pagamento pendente'),
          pending?.message ?? 'sem mensagem'
        );
        check(
          'PAYMENT_PENDING tem link /appointments/{id}',
          pending?.link === `/appointments/${appointmentId}`,
          `link=${pending?.link}`
        );
        if (pending) cleanup.notifications.push(pending.id);

        const recepcaoList = await listNotifications(recepcao);
        const pendingRecepcao = recepcaoList.find(
          (n: any) =>
            n.type === NotificationType.PAYMENT_PENDING &&
            n.link === `/appointments/${appointmentId}`
        );
        check(
          'PAYMENT_PENDING também chega para Recepção',
          !!pendingRecepcao,
          pendingRecepcao ? `id=${pendingRecepcao.id}` : 'notificação não encontrada'
        );
        if (pendingRecepcao) cleanup.notifications.push(pendingRecepcao.id);

        // Confirmar pagamento → PAYMENT_PAID
        const payment = await prisma.payment.findFirst({
          where: { appointmentId },
          select: { id: true },
        });

        if (payment) {
          cleanup.payments.push(payment.id);
          const confirmed = await req(`/payments/${payment.id}/confirm`, admin, { method: 'POST' });
          check(
            'POST /payments/:id/confirm confirma pagamento',
            confirmed.status < 300,
            `status=${confirmed.status}`
          );

          const afterPay = await listNotifications(admin);
          const paid = afterPay.find(
            (n: any) =>
              n.type === NotificationType.PAYMENT_PAID &&
              n.link === `/appointments/${appointmentId}`
          );
          check(
            'confirmar pagamento gera PAYMENT_PAID',
            !!paid,
            paid ? `id=${paid.id}` : 'notificação não encontrada'
          );
          check(
            'mensagem de pagamento pago tem o texto do Jonathas',
            !!paid &&
              paid.message.startsWith(`Agendamento de ${testClient.name} (`) &&
              paid.message.endsWith(') Pago com sucesso!'),
            paid?.message ?? 'sem mensagem'
          );
          check(
            'PAYMENT_PAID tem link /appointments/{id}',
            paid?.link === `/appointments/${appointmentId}`,
            `link=${paid?.link}`
          );
          if (paid) cleanup.notifications.push(paid.id);

          // Confirmar de novo não duplica
          await req(`/payments/${payment.id}/confirm`, admin, { method: 'POST' });
          const afterSecond = await listNotifications(admin);
          const paidAgain = afterSecond.filter(
            (n: any) =>
              n.type === NotificationType.PAYMENT_PAID &&
              n.link === `/appointments/${appointmentId}`
          );
          check(
            'confirmar pagamento 2x não duplica PAYMENT_PAID',
            paidAgain.length === 1,
            `itens=${paidAgain.length}`
          );
          paidAgain.forEach((n: any) => {
            if (!cleanup.notifications.includes(n.id)) cleanup.notifications.push(n.id);
          });
        }
      }
    } else {
      check('dados base para Task 5 disponíveis', false, 'cliente/staff/serviço não encontrados');
    }

    // ------------------------------------------------------------- Task 6
    const mariaToken = await login('maria@salao.com', 'staff123');
    // Criador do agendamento "soon": staff de teste (sempre livre) evita a
    // colisão de slot com appointments reais do seed (ex.: Maria 10:00-11:00).
    const creatorStaffId = verifyStaffId ?? mariaStaff.id;
    const creatorToken = verifyEmail
      ? await login(verifyEmail, 'verify123').catch(() => null)
      : null;
    const formerToken = creatorToken ?? mariaToken;

    // Agendamento que começa em ~45s. Se o slot estiver ocupado (resíduo de
    // execução anterior), tenta alguns minutos à frente.
    let startAt = new Date(Date.now() + 45_000);
    let soonAppt: any = null;
    let soonId: string | undefined;
    let lastAttempt: any = null;

    for (const extraSeconds of [0, 20_000, 40_000, 60_000]) {
      const candidate = new Date(Date.now() + 45_000 + extraSeconds);
      const res = await req('/appointments', admin, {
        method: 'POST',
        body: JSON.stringify({
          clientId: testClient.id,
          staffId: creatorStaffId,
          startTime: candidate.toISOString(),
          services: [
            {
              id: testService.id,
              name: testService.name,
              price: testService.price,
              duration: testService.durationMinutes,
            },
          ],
        }),
      });
      lastAttempt = res;

      if (res.status < 300) {
        soonAppt = res;
        soonId = res.body?.data?.appointment?.id;
        startAt = candidate;
        break;
      }
    }

    check(
      'POST /appointments cria agendamento para o aviso de horário',
      !!soonId,
      `status=${(soonAppt ?? lastAttempt)?.status ?? 'n/a'} id=${soonId ?? 'n/a'} msg=${(soonAppt ?? lastAttempt)?.body?.message ?? (soonAppt ?? lastAttempt)?.body?.error ?? JSON.stringify((soonAppt ?? lastAttempt)?.body ?? '').slice(0, 200)}`
    );

    if (soonId) {
      cleanup.appointments.push(soonId);

      // Reatribuição de profissional: o aviso deve ir para o profissional ATUAL
      // (o worker resolve os destinatários no momento da entrega, não no
      // momento do agendamento).
      const anaStaff = await prisma.staff.findFirst({
        where: { user: { email: 'ana@salao.com' } },
        select: { id: true },
      });
      const anaToken = anaStaff ? await login('ana@salao.com', 'staff123') : null;
      if (anaStaff) {
        const reassigned = await req(`/appointments/${soonId}`, admin, {
          method: 'PUT',
          body: JSON.stringify({ staffId: anaStaff.id }),
        });
        check(
          'reatribuição de profissional do agendamento',
          reassigned.status < 300,
          `status=${reassigned.status} msg=${reassigned.body?.message ?? ''}`
        );
      }

      // Antes do horário: não pode existir APPOINTMENT_STARTING
      const beforeList = await listNotifications(admin);
      const before = beforeList.filter(
        (n: any) => n.type === NotificationType.APPOINTMENT_STARTING && n.appointmentId === soonId
      );
      check(
        'APPOINTMENT_STARTING não chega antes do horário',
        before.length === 0,
        `itens=${before.length}`
      );

      // Espera o horário + folga para o worker processar
      const waitMs = Math.max(0, startAt.getTime() - Date.now()) + 10_000;
      console.log(`   (aguardando ${Math.round(waitMs / 1000)}s para o aviso de horário)`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));

      const afterList = await listNotifications(admin);
      const starting = afterList.filter(
        (n: any) => n.type === NotificationType.APPOINTMENT_STARTING && n.appointmentId === soonId
      );
      check(
        'agendamento que começa agora gera APPOINTMENT_STARTING para Admin',
        starting.length === 1,
        `itens=${starting.length}`
      );
      check(
        'APPOINTMENT_STARTING tem link /appointments/{id}',
        starting[0]?.link === `/appointments/${soonId}`,
        `link=${starting[0]?.link}`
      );
      starting.forEach((n: any) => cleanup.notifications.push(n.id));

      const formerList = await listNotifications(formerToken);
      const formerStarting = formerList.filter(
        (n: any) => n.type === NotificationType.APPOINTMENT_STARTING && n.appointmentId === soonId
      );

      if (anaStaff && anaToken) {
        // Reatribuído: o antigo NÃO recebe, o novo recebe.
        check(
          'profissional anterior NÃO recebe o aviso',
          formerStarting.length === 0,
          `itens=${formerStarting.length}`
        );
        formerStarting.forEach((n: any) => cleanup.notifications.push(n.id));

        const anaList = await listNotifications(anaToken);
        const anaStarting = anaList.filter(
          (n: any) => n.type === NotificationType.APPOINTMENT_STARTING && n.appointmentId === soonId
        );
        check(
          'profissional atual (reatribuído) recebe o aviso',
          anaStarting.length === 1,
          `itens=${anaStarting.length}`
        );
        anaStarting.forEach((n: any) => cleanup.notifications.push(n.id));
      } else {
        check(
          'APPOINTMENT_STARTING chega para o profissional do agendamento',
          formerStarting.length === 1,
          `itens=${formerStarting.length}`
        );
        formerStarting.forEach((n: any) => cleanup.notifications.push(n.id));
      }

      const recepcaoStarting = (await listNotifications(recepcao)).filter(
        (n: any) => n.type === NotificationType.APPOINTMENT_STARTING && n.appointmentId === soonId
      );
      check(
        'APPOINTMENT_STARTING chega para Recepção',
        recepcaoStarting.length === 1,
        `itens=${recepcaoStarting.length}`
      );
      recepcaoStarting.forEach((n: any) => cleanup.notifications.push(n.id));

      // Reconciliador rodando por cima não pode duplicar
      await runAppointmentStartReconcile();
      const afterReconcile = await listNotifications(admin);
      const afterReconcileItems = afterReconcile.filter(
        (n: any) => n.type === NotificationType.APPOINTMENT_STARTING && n.appointmentId === soonId
      );
      check(
        'reconciliador não duplica APPOINTMENT_STARTING',
        afterReconcileItems.length === 1,
        `itens=${afterReconcileItems.length}`
      );
    }

    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nTOTAL: ${results.length - failed}/${results.length} passaram`);

    await cleanupAll();
    await prisma.$disconnect();
    // A limpeza importa queue.ts (conexões ioredis ficam abertas e seguram o
    // event loop) — exit explícito senão o processo nunca termina.
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('ERRO NO SCRIPT:', error);
    await cleanupAll();
    await prisma.$disconnect();
    process.exit(1);
  }
})();
