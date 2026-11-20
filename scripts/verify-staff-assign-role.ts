// Gate: POST /staff/:id/assign-role — contrato do endpoint dedicado.
//
// Por que existe: o frontend usava GET /staff/:id (liava `data.data`, mas a API
// responde `data.staff`) + POST /roles/:roleId/assign/:userId (aceita userId e
// ignora cargo inativo). Este gate trava o contrato novo:
//   - exige staff.id REAL (userId de item pendente → 404)
//   - cargo inexistente → 404
//   - cargo INATIVO → rejeitado (paridade com o endpoint de roles)
//   - item perfilado na listagem usa o staff.id real
//
// SEGURANÇA DO GATE (fix do achado MÉDIA do review 2026-11-15):
//   O gate NÃO toca nenhum usuário do seed. Cria dois fixtures próprios
//   (verify.assign.*): um com perfil de staff e um sem perfil. Todas as
//   chamadas mutantes (assign-role) apontam para o fixture, nunca para Ana,
//   Maria ou Admin. O cleanup roda em `finally` e é failure-safe — cada
//   etapa é ISOLADA (uma falha não aborta as demais) e a prova de resíduo
//   roda MESMO se o cleanup falhar:
//     1. restaura o cargo do fixture via Prisma (não HTTP: o endpoint
//        assign-role valida cargo ativo e dependeria do backend no ar)
//     2. apaga notificações NEW_USER/NEW_STAFF do gate por MARCADOR
//        (Notification.user é SetNull → sobraria notificação órfã)
//     3. apaga o usuário do fixture (cascade apaga o perfil de staff)
//     4. apaga TODOS os cargos temporários "Verify Inativo *" (inclusive os
//        deixados por runs mortos)
// Se o gate for morto no meio, o próximo run começa com saneamento do
// resíduo (self-healing: notificação → usuário → cargo), em vez de apenas
// reportar o problema e falhar para sempre.
//
// Efeitos colaterais: escritas temporárias no banco Neon (aprovadas pelo
// Jonathas em 2026-11-15) + 1 cargo temporário inativo, tudo revertido no run.
// Pré-condição: backend rodando em :4000, seed aplicado.
import { PrismaClient } from '@prisma/client';

const API = 'http://localhost:4000/api/v1';
const prisma = new PrismaClient();

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return body.data.accessToken;
}

async function req(path: string, token: string, options: any = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  let body: any;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const asItems = (res: any) => (Array.isArray(res.body?.data) ? res.body.data : []);

// Marcador único do gate na mensagem da notificação NEW_STAFF
// ("Novo profissional cadastrado: <nome>"). Sem stamp fixo, o cleanup
// por dedupeKey do run atual deixa as NEW_STAFF de runs anteriores órfãs.
const NEW_STAFF_MARKER = 'Verify Profissional';

// Prefixos Exclusive do gate — nunca casam com dado do seed.
const GATE_USER_PREFIX = 'verify.assign.';
const GATE_ROLE_PREFIX = 'Verify Inativo';

// Notificações produzidas pelo gate (qualquer run): NEW_USER cita o e-mail
// do fixture; NEW_STAFF cita o NOME do fixture (`Verify Profissional <stamp>`).
// Cobre também o 2º admin do seed (a API lista só as do admin logado).
const gateNotifWhere = (extra: any[] = []): any => ({
  OR: [
    { type: 'NEW_USER', message: { contains: GATE_USER_PREFIX } },
    { type: 'NEW_STAFF', message: { contains: NEW_STAFF_MARKER } },
    ...extra,
  ],
});

// Contagem de resíduo do gate (usuários, perfil, cargos, notificações).
const gateResidue = async () => ({
  users: await prisma.user.count({ where: { email: { startsWith: GATE_USER_PREFIX } } }),
  staff: await prisma.staff.count({
    where: { user: { email: { startsWith: GATE_USER_PREFIX } } },
  }),
  roles: await prisma.role.count({ where: { name: { startsWith: GATE_ROLE_PREFIX } } }),
  notif: await prisma.notification.count({ where: gateNotifWhere() }),
});

(async () => {
  let fails = 0;
  const pass = (ok: boolean, label: string, extra = '') => {
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` | ${extra}` : ''}`);
  };

  const token = await login('admin@salao.com', 'admin123');

  const profissionalRole = await prisma.role.findFirst({ where: { name: 'Profissional' } });
  if (!profissionalRole) {
    console.log('FALHAS: 1');
    console.log('FAIL | cargo Profissional não existe no banco');
    await prisma.$disconnect();
    process.exit(1);
  }

  // ------------------------------------------------------------------
  // 0) Resíduo de execuções anteriores mortas → LIMPA (self-healing)
  //
  // O gate NÃO apenas reporta: um run morto deixaria cargo temporário e
  // notificação NEW_STAFF órfã (Notification.user é SetNull) e o próximo
  // run só voltaria a apontar o problema. Aqui o run anterior é saneado
  // antes de começar — cada etapa isolada, ordem por FK:
  //   notificação → usuário (cascade staff) → cargo
  // ------------------------------------------------------------------
  const stale = await gateResidue();
  const staleTotal = stale.users + stale.staff + stale.roles + stale.notif;

  if (staleTotal > 0) {
    console.log(
      `STALE | resíduo de execução anterior | users=${stale.users} staff=${stale.staff} roles=${stale.roles} notif=${stale.notif}`
    );
    const staleErrors: string[] = [];
    const staleStep = async (label: string, fn: () => Promise<string>) => {
      try {
        console.log(`STALE CLEANUP | ${await fn()}`);
      } catch (err: any) {
        staleErrors.push(`${label}: ${err?.message ?? String(err)}`);
        console.log(`STALE CLEANUP ERRO | ${label} | ${err?.message ?? String(err)}`);
      }
    };

    await staleStep('notificações do gate', async () => {
      const r = await prisma.notification.deleteMany({ where: gateNotifWhere() });
      return `notificações removidas | count=${r.count}`;
    });
    await staleStep('usuários verify.assign.*', async () => {
      const r = await prisma.user.deleteMany({
        where: { email: { startsWith: GATE_USER_PREFIX } },
      });
      return `usuários removidos | count=${r.count}`;
    });
    await staleStep('cargos Verify Inativo *', async () => {
      const r = await prisma.role.deleteMany({
        where: { name: { startsWith: GATE_ROLE_PREFIX } },
      });
      return `cargos removidos | count=${r.count}`;
    });

    const afterStale = await gateResidue();
    pass(
      staleErrors.length === 0 &&
        afterStale.users === 0 &&
        afterStale.staff === 0 &&
        afterStale.roles === 0 &&
        afterStale.notif === 0,
      'resíduo de execução anterior removido (self-healing)',
      `antes users=${stale.users} staff=${stale.staff} roles=${stale.roles} notif=${stale.notif} | depois users=${afterStale.users} staff=${afterStale.staff} roles=${afterStale.roles} notif=${afterStale.notif}${
        staleErrors.length ? ` | erros=${staleErrors.join(' | ')}` : ''
      }`
    );
  } else {
    pass(
      true,
      'sem resíduo de execução anterior (verify.assign.* / Verify Inativo / notificações do gate)',
      'users=0 staff=0 roles=0 notif=0'
    );
  }

  // ------------------------------------------------------------------
  // 1) Fixtures dedicados (nunca tocam o seed)
  // ------------------------------------------------------------------
  const stamp = Date.now();
  const emailPro = `verify.assign.pro.${stamp}@teste.local`;
  const emailPen = `verify.assign.pen.${stamp}@teste.local`;

  let proUserId: string | null = null;
  let proStaffId: string | null = null;
  let penUserId: string | null = null;
  let tempRoleId: string | null = null;

  try {
    // 1a) Fixture pendente: usuário com cargo elegível, SEM perfil de staff
    const penUser = await req('/users', token, {
      method: 'POST',
      body: JSON.stringify({
        email: emailPen,
        password: 'verify123',
        name: 'Verify Pendente',
        roleId: profissionalRole.id,
      }),
    });
    pass(penUser.status === 201, 'fixture pendente: POST /users cria usuário', String(penUser.status));
    penUserId = penUser.body?.data?.user?.id ?? penUser.body?.data?.id ?? null;
    pass(!!penUserId, 'fixture pendente: devolve userId', penUserId ?? 'n/a');

    // 1b) Fixture perfilado: usuário + perfil de staff
    const proUser = await req('/users', token, {
      method: 'POST',
      body: JSON.stringify({
        email: emailPro,
        password: 'verify123',
        name: `${NEW_STAFF_MARKER} ${stamp}`,
        roleId: profissionalRole.id,
      }),
    });
    pass(proUser.status === 201, 'fixture perfilado: POST /users cria usuário', String(proUser.status));
    proUserId = proUser.body?.data?.user?.id ?? proUser.body?.data?.id ?? null;
    pass(!!proUserId, 'fixture perfilado: devolve userId', proUserId ?? 'n/a');

    if (proUserId) {
      const proStaff = await req('/staff', token, {
        method: 'POST',
        body: JSON.stringify({ userId: proUserId, specialties: ['Cabelo'] }),
      });
      pass(proStaff.status === 201, 'fixture perfilado: POST /staff cria perfil', String(proStaff.status));
      proStaffId = proStaff.body?.data?.staff?.id ?? null;
      pass(!!proStaffId, 'fixture perfilado: devolve staff.id', proStaffId ?? 'n/a');
    }

    // ------------------------------------------------------------------
    // 2) Listagem: item perfilado usa staff.id real; pendente usa userId
    // ------------------------------------------------------------------
    if (proStaffId) {
      const listed = asItems(await req(`/staff?search=${encodeURIComponent(emailPro)}`, token))[0];
      pass(!!listed, 'fixture perfilado aparece na listagem');
      pass(listed?.hasProfile === true, 'item perfilado tem hasProfile=true', String(listed?.hasProfile));
      pass(
        listed?.id === proStaffId && listed?.id !== listed?.userId,
        'item perfilado usa o staff.id real (id ≠ userId)',
        `id=${listed?.id} staffId=${proStaffId} userId=${listed?.userId}`
      );

      const detail = await req(`/staff/${proStaffId}`, token);
      pass(
        detail.status === 200 && detail.body?.data?.staff?.id === proStaffId,
        'GET /staff/{staffId} do fixture responde 200 com o id real',
        `status=${detail.status}`
      );
    }

    if (penUserId) {
      const listedPen = asItems(await req(`/staff?search=${encodeURIComponent(emailPen)}`, token))[0];
      pass(!!listedPen, 'fixture pendente aparece na listagem');
      pass(
        listedPen?.hasProfile === false,
        'item pendente tem hasProfile=false',
        String(listedPen?.hasProfile)
      );
      pass(
        listedPen?.id === penUserId,
        'item pendente: id = userId (nunca staff.id)',
        `id=${listedPen?.id} userId=${penUserId}`
      );
    }

    // ------------------------------------------------------------------
    // 3) Atribuição de cargo — caminho feliz (mesmo cargo do fixture)
    // ------------------------------------------------------------------
    if (proStaffId) {
      const assigned = await req(`/staff/${proStaffId}/assign-role`, token, {
        method: 'POST',
        body: JSON.stringify({ roleId: profissionalRole.id }),
      });
      pass(assigned.status === 200, 'POST /staff/:id/assign-role → 200', String(assigned.status));
      pass(
        assigned.body?.data?.staff?.id === proStaffId,
        'assign-role devolve o staff.id alvo',
        `staffId=${assigned.body?.data?.staff?.id}`
      );
      pass(
        assigned.body?.data?.staff?.roleName === 'Profissional',
        'assign-role devolve o cargo aplicado',
        `roleName=${assigned.body?.data?.staff?.roleName}`
      );

      const after = asItems(await req(`/staff?search=${encodeURIComponent(emailPro)}`, token))[0];
      pass(
        after?.role?.name === 'Profissional',
        'cargo do fixture permanece Profissional após o gate',
        `role=${after?.role?.name}`
      );
    }

    // ------------------------------------------------------------------
    // 4) Atribuição de cargo — userId de pendente NÃO é staff.id
    // ------------------------------------------------------------------
    if (penUserId) {
      const bogus = await req(`/staff/${penUserId}/assign-role`, token, {
        method: 'POST',
        body: JSON.stringify({ roleId: profissionalRole.id }),
      });
      pass(bogus.status === 404, 'assign-role com userId (item pendente) → 404', String(bogus.status));
      pass(
        /not found|não encontrado/i.test(String(bogus.body?.message ?? '')),
        'assign-role com userId → mensagem de staff inexistente',
        String(bogus.body?.message ?? '')
      );
    }

    // ------------------------------------------------------------------
    // 5) Atribuição de cargo — roleId inexistente
    // ------------------------------------------------------------------
    if (proStaffId) {
      const ghostRole = await req(`/staff/${proStaffId}/assign-role`, token, {
        method: 'POST',
        body: JSON.stringify({ roleId: '00000000-0000-4000-8000-000000000000' }),
      });
      pass(ghostRole.status === 404, 'assign-role com roleId inexistente → 404', String(ghostRole.status));
      pass(
        /role not found|cargo não encontrado/i.test(String(ghostRole.body?.message ?? '')),
        'assign-role com roleId inexistente → mensagem de cargo inexistente',
        String(ghostRole.body?.message ?? '')
      );
    }

    // ------------------------------------------------------------------
    // 6) Atribuição de cargo — cargo INATIVO é rejeitado
    // ------------------------------------------------------------------
    const perms = asItems(await req('/roles/permissions', token));
    const perm = perms.find((p: any) => p.name === 'staff.read') ?? perms[0];
    pass(!!perm, 'permissão disponível para montar o cargo de teste', perm?.name ?? 'n/a');

    const tempName = `Verify Inativo ${stamp}`;
    try {
      const created = await req('/roles', token, {
        method: 'POST',
        body: JSON.stringify({
          name: tempName,
          description: 'Cargo temporário do gate verify-staff-assign-role',
          permissionIds: perm ? [perm.id] : [],
        }),
      });
      pass(created.status === 201, 'POST /roles cria cargo temporário', String(created.status));
      tempRoleId = created.body?.data?.id ?? null;
      pass(!!tempRoleId, 'cargo temporário devolve id', tempRoleId ?? 'n/a');

      if (tempRoleId && proStaffId) {
        const off = await req(`/roles/${tempRoleId}`, token, {
          method: 'PUT',
          body: JSON.stringify({ isActive: false }),
        });
        pass(off.status === 200, 'PUT /roles/:id desativa o cargo temporário', String(off.status));

        const inactive = await req(`/staff/${proStaffId}/assign-role`, token, {
          method: 'POST',
          body: JSON.stringify({ roleId: tempRoleId }),
        });
        pass(
          inactive.status === 400,
          'assign-role com cargo inativo → 400 (rejeitado)',
          String(inactive.status)
        );
        pass(
          /inactive|inativo/i.test(String(inactive.body?.message ?? '')),
          'assign-role com cargo inativo → mensagem cita "inactive"',
          String(inactive.body?.message ?? '')
        );

        const stillProf = asItems(await req(`/staff?search=${encodeURIComponent(emailPro)}`, token))[0];
        pass(
          stillProf?.role?.name === 'Profissional',
          'cargo inativo NÃO foi aplicado ao fixture',
          `role=${stillProf?.role?.name}`
        );
      }
    } catch (err) {
      pass(false, 'bloco do cargo inativo executou sem exceção', String(err));
    }
  } finally {
    // ------------------------------------------------------------------
    // CLEANUP failure-safe (roda mesmo se o gate falhar no meio).
    // Cada etapa é ISOLADA: uma falha (HTTP/Prisma) não pode abortar as
    // demais — é justamente no caminho de falha que o cleanup importa.
    // ------------------------------------------------------------------
    const cleanupErrors: string[] = [];

    const step = async (label: string, fn: () => Promise<string>) => {
      try {
        console.log(`CLEANUP | ${await fn()}`);
      } catch (err: any) {
        cleanupErrors.push(`${label}: ${err?.message ?? String(err)}`);
        console.log(`CLEANUP ERRO | ${label} | ${err?.message ?? String(err)}`);
      }
    };

    // 1) restaura o cargo do fixture via Prisma (não HTTP: o endpoint
    //    assign-role valida cargo ativo e dependeria do backend no ar)
    if (proUserId) {
      await step('restaura cargo do fixture', async () => {
        const restore = await prisma.user.update({
          where: { id: proUserId },
          data: { roleId: profissionalRole.id },
        });
        return `cargo do fixture restaurado | roleId=${restore.roleId}`;
      });
    }

    // 2) notificações do gate — por MARCADOR, para cobrir também as
    //    notificações de runs anteriores (Notification.user é SetNull → órfã).
    await step('remove notificações do gate', async () => {
      const notif = await prisma.notification.deleteMany({
        where: gateNotifWhere(
          proStaffId ? [{ dedupeKey: `NEW_STAFF:${proStaffId}` }] : []
        ),
      });
      return `notificações do gate removidas | count=${notif.count}`;
    });

    // 4) usuários do fixture (cascade remove o perfil de staff)
    await step('remove usuários verify.assign.*', async () => {
      const users = await prisma.user.deleteMany({
        where: { email: { startsWith: GATE_USER_PREFIX } },
      });
      return `usuários verify.assign.* removidos | count=${users.count}`;
    });

    // 5) cargos temporários Verify Inativo * — TODOS, inclusive deixados por
    //    runs mortos (Prisma: DELETE HTTP é bloqueado com usuário atribuído e
    //    o gate precisa zerar o resíduo mesmo quando o run morreu).
    await step('remove cargos Verify Inativo *', async () => {
      const del = await prisma.role.deleteMany({
        where: { name: { startsWith: GATE_ROLE_PREFIX } },
      });
      return `cargos temporários removidos | count=${del.count}`;
    });

    // 6) prova de ausência de resíduo (inclui notificações órfãs NEW_STAFF)
    let restUsers = -1;
    let restStaff = -1;
    let restRoles = -1;
    let restNotif = -1;
    await step('prova de resíduo zero', async () => {
      const rest = await gateResidue();
      restUsers = rest.users;
      restStaff = rest.staff;
      restRoles = rest.roles;
      restNotif = rest.notif;
      return `resíduo | users=${restUsers} staff=${restStaff} roles=${restRoles} notif=${restNotif}`;
    });

    pass(
      restUsers === 0 && restStaff === 0 && restRoles === 0 && restNotif === 0,
      'resíduo zero após o gate',
      `users=${restUsers} staff=${restStaff} roles=${restRoles} notif=${restNotif}`
    );
    pass(cleanupErrors.length === 0, 'cleanup sem erros', cleanupErrors.join(' | ') || 'ok');
  }

  console.log(`\nFALHAS: ${fails}`);
  await prisma.$disconnect();
  process.exit(fails === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error('ERRO no gate:', err);
  await prisma.$disconnect();
  process.exit(2);
});
