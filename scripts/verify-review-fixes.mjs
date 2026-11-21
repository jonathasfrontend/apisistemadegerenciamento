const API = 'http://localhost:4000/api/v1';

async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return body.data.accessToken;
}

async function req(path, token, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let body;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ` | ${detail}` : ''}`);
};

(async () => {
  const admin = await login('admin@salao.com', 'admin123');

  // 1) Notificações: page/limit validados
  const badPage = await req('/notifications?page=abc&limit=999999', admin);
  const limitUsed = badPage.body?.data?.limit;
  check('notifications page=abc não quebra', badPage.status === 200, `status=${badPage.status} limit=${limitUsed}`);
  check('notifications limit clamped <= 100', limitUsed <= 100, `limit=${limitUsed}`);

  const negLimit = await req('/notifications?page=-3&limit=-9', admin);
  check('notifications page/limit negativos normalizados', negLimit.status === 200 && negLimit.body?.data?.page === 1 && negLimit.body?.data?.limit === 1, `page=${negLimit.body?.data?.page} limit=${negLimit.body?.data?.limit}`);

  const junkLimit = await req('/notifications?limit=12abc', admin);
  check('notifications limit=12abc usa default (não vira 12)', junkLimit.body?.data?.limit === 20, `limit=${junkLimit.body?.data?.limit}`);

  // 2) Limite server-side em services/products
  const svc = await req('/services?search=c&limit=2', admin);
  check('services respeita limit', Array.isArray(svc.body?.data) && svc.body.data.length <= 2, `itens=${svc.body?.data?.length}`);
  const prod = await req('/products?search=a&limit=2', admin);
  check('products respeita limit', Array.isArray(prod.body?.data) && prod.body.data.length <= 2, `itens=${prod.body?.data?.length}`);

  // 3) Appointment: no-show idempotente + contador
  const clientsRes = await req('/clients?limit=10', admin);
  const staffList = await req('/staff?limit=1', admin);
  const services = await req('/services?isActive=true', admin);
  const svcOne = services.body.data[0];

  // Clientes rotacionados: 3 faltas no MESMO cliente bloqueiam (auto-block),
  // o que derrubaria a criação dos próximos appointments.
  const clients = (clientsRes.body?.data || []).filter((c) => !c.isBlocked);
  check('clientes de teste disponíveis', clients.length >= 3, `clientes=${clients.length}`);

  // Estado inicial de cada cliente usado (restaurado no final).
  const initialState = new Map();
  for (const c of clients.slice(0, 4)) {
    initialState.set(c.id, { noShowCount: c.noShowCount ?? 0, isBlocked: !!c.isBlocked });
  }

  let clientCursor = 0;
  const nextClient = () => {
    const c = clients[clientCursor % clients.length];
    clientCursor++;
    return c;
  };

  const createdIds = [];

  const createAppt = async (dayOffset, label) => {
    const client = nextClient();
    const body = {
      clientId: client.id,
      staffId: staffList.body.data[0].id,
      startTime: new Date(Date.now() + dayOffset * 86400000 + 13 * 3600000).toISOString(),
      services: [
        { id: svcOne.id, name: svcOne.name, price: svcOne.price, duration: svcOne.durationMinutes },
      ],
    };
    const created = await req('/appointments', admin, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const id = created.body?.data?.appointment?.id;
    check(`${label} criado`, created.status === 201 && !!id, `status=${created.status} id=${id} msg=${created.body?.message ?? ''}`);
    if (id) createdIds.push(id);
    return { id, clientId: client.id, created };
  };

  const first = await createAppt(3, 'appointment');
  const clientId = first.clientId;
  const noShowBefore = initialState.get(clientId).noShowCount;

  const noShow1 = await req(`/appointments/${first.id}/no-show`, admin, { method: 'POST' });
  check('primeiro no-show aceito', noShow1.status === 200, `status=${noShow1.status}`);

  const noShow2 = await req(`/appointments/${first.id}/no-show`, admin, { method: 'POST' });
  check('segundo no-show rejeitado (400)', noShow2.status === 400, `status=${noShow2.status} msg=${noShow2.body?.message}`);

  const after = await req(`/clients/${clientId}`, admin);
  const noShowAfter = after.body?.data?.client?.noShowCount ?? 0;
  check('contador noShow incrementou só 1x', noShowAfter === noShowBefore + 1, `antes=${noShowBefore} depois=${noShowAfter}`);

  // 4) Cancel idempotente
  const second = await createAppt(4, 'appointment de cancelamento');
  const cancel1 = await req(`/appointments/${second.id}/cancel`, admin, { method: 'POST' });
  check('primeiro cancel aceito', cancel1.status === 200, `status=${cancel1.status}`);
  const cancel2 = await req(`/appointments/${second.id}/cancel`, admin, { method: 'POST' });
  check('segundo cancel rejeitado (400)', cancel2.status === 400, `status=${cancel2.status} msg=${cancel2.body?.message}`);

  // 5) PUT não pode burlar cancel/no-show (status terminal fora do schema)
  const third = await createAppt(5, 'appointment de PUT');
  const putCancel = await req(`/appointments/${third.id}`, admin, { method: 'PUT', body: JSON.stringify({ status: 'CANCELLED' }) });
  check('PUT com status=CANCELLED rejeitado', putCancel.status === 400, `status=${putCancel.status}`);
  const putNoShow = await req(`/appointments/${third.id}`, admin, { method: 'PUT', body: JSON.stringify({ status: 'NO_SHOW' }) });
  check('PUT com status=NO_SHOW rejeitado', putNoShow.status === 400, `status=${putNoShow.status}`);

  // 6) Chamadas concorrentes: só uma requisição podevezar a transição
  const fourth = await createAppt(6, 'appointment de concorrência (no-show)');
  const [r1, r2] = await Promise.all([
    req(`/appointments/${fourth.id}/no-show`, admin, { method: 'POST' }),
    req(`/appointments/${fourth.id}/no-show`, admin, { method: 'POST' }),
  ]);
  const okCount = [r1, r2].filter((r) => r.status === 200).length;
  const badCount = [r1, r2].filter((r) => r.status === 400).length;
  check('no-show concorrente: 1x 200 e 1x 400', okCount === 1 && badCount === 1, `status=${r1.status}/${r2.status}`);

  const fifth = await createAppt(7, 'appointment de concorrência (cancel)');
  const [c1, c2] = await Promise.all([
    req(`/appointments/${fifth.id}/cancel`, admin, { method: 'POST' }),
    req(`/appointments/${fifth.id}/cancel`, admin, { method: 'POST' }),
  ]);
  const okCancel = [c1, c2].filter((r) => r.status === 200).length;
  const badCancel = [c1, c2].filter((r) => r.status === 400).length;
  check('cancel concorrente: 1x 200 e 1x 400', okCancel === 1 && badCancel === 1, `status=${c1.status}/${c2.status}`);

  // 7) limite degenerado não pode devolver a tabela inteira
  const svcZero = await req('/services?limit=0', admin);
  check('services limit=0 não abre a tabela', Array.isArray(svcZero.body?.data) && svcZero.body.data.length <= 1, `itens=${svcZero.body?.data?.length}`);
  const prodZero = await req('/products?limit=0', admin);
  check('products limit=0 não abre a tabela', Array.isArray(prodZero.body?.data) && prodZero.body.data.length <= 1, `itens=${prodZero.body?.data?.length}`);
  const svcInvalid = await req('/services?limit=abc', admin);
  check('services limit=abc usa default', Array.isArray(svcInvalid.body?.data) && svcInvalid.body.data.length <= 20, `itens=${svcInvalid.body?.data?.length}`);

  // 8) página absurdo é limitada (skip gigante no banco)
  const hugePage = await req('/notifications?page=99999', admin);
  check('notifications page tem teto', hugePage.status === 200 && hugePage.body?.data?.page <= 1000, `page=${hugePage.body?.data?.page}`);

  // 9) transições cruzadas: no-show não pode virar cancelamento (e vice-versa)
  const sixth = await createAppt(8, 'appointment de transição cruzada (no-show)');
  await req(`/appointments/${sixth.id}/no-show`, admin, { method: 'POST' });
  const crossCancel = await req(`/appointments/${sixth.id}/cancel`, admin, { method: 'POST' });
  check('cancel após no-show rejeitado', crossCancel.status === 400, `status=${crossCancel.status} msg=${crossCancel.body?.message}`);

  const seventh = await createAppt(9, 'appointment de transição cruzada (cancel)');
  await req(`/appointments/${seventh.id}/cancel`, admin, { method: 'POST' });
  const crossNoShow = await req(`/appointments/${seventh.id}/no-show`, admin, { method: 'POST' });
  check('no-show após cancel rejeitado', crossNoShow.status === 400, `status=${crossNoShow.status} msg=${crossNoShow.body?.message}`);

  // 10) limite com lixo não pode virar limite parcial (12abc)
  const svcJunk = await req('/services?limit=12abc', admin);
  check('services limit=12abc rejeitado como inválido', Array.isArray(svcJunk.body?.data) && svcJunk.body.data.length <= 20, `itens=${svcJunk.body?.data?.length}`);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nTOTAL: ${results.length - failed}/${results.length} passaram`);

  // 11) Auto-limpeza: o script não pode deixar lixo no banco.
  if (createdIds.length > 0) {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    // 0B.1: fail-closed — sem empresa resolvida, nenhum delete de fixture roda.
    const company = await prisma.company.findFirst({
      where: { name: process.env.FINANCE_COMPANY_NAME || 'Empresa padrão' },
    });
    if (!company) throw new Error('[gate] Empresa não encontrada — abortando cleanup.');
    const cid = company.id;

    await prisma.notification.deleteMany({ where: { companyId: cid, appointmentId: { in: createdIds } } });
    await prisma.payment.deleteMany({ where: { companyId: cid, appointmentId: { in: createdIds } } });
    await prisma.appointment.deleteMany({ where: { companyId: cid, id: { in: createdIds } } });

    // Restaura contador de faltas e bloqueio exatamente como estavam.
    for (const [id, state] of initialState.entries()) {
      await prisma.client.updateMany({
        where: { companyId: cid, id },
        data: { noShowCount: state.noShowCount, isBlocked: state.isBlocked },
      });
    }

    console.log(`LIMPEZA: ${createdIds.length} appointment(s) removido(s), ${initialState.size} cliente(s) restaurado(s)`);
    await prisma.$disconnect();
  }
})();
