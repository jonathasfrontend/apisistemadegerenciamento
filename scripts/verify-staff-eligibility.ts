// Gate: POST /staff cria perfil para usuário ATIVO com QUALQUER cargo.
//
// Uso: npx tsx scripts/verify-staff-eligibility.ts
// Pré-condição: backend rodando em :4000, seed aplicado.
//
// Seções: regra pura; HTTP negativo sem cargo; HTTP positivo com qualquer cargo;
// caminho válido com isAvailable e cleanup do que o gate criou.
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

const API = 'http://localhost:4000/api/v1';
const prisma = new PrismaClient();

let fails = 0;
const pass = (ok: boolean, label: string, extra = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` | ${extra}` : ''}`);
};
const captureMessage = (fn: () => void) => { try { fn(); return ''; } catch (e: any) { return e.message; } };

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return body.data.accessToken;
}

async function req(path: string, token: string, options: Record<string, any> = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
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

(async () => {
  // ---------------------------------------------------------------------
  // 1) Regra de elegibilidade (pura, sem banco)
  // ---------------------------------------------------------------------
  const modPath = '../src/api/v1/staff/staff-eligibility';
  let mod: any = null;
  try {
    mod = await import(modPath);
  } catch {
    mod = null;
  }

  if (!mod || typeof mod.isStaffProfileEligible !== 'function' || typeof mod.assertStaffProfileEligibility !== 'function') {
    pass(false, 'regra de elegibilidade existe (isStaffProfileEligible + assertStaffProfileEligibility)');
    pass(false, 'lista branca STAFF_ELIGIBLE_ROLE_NAMES removida');
    pass(false, 'Admin ativo é elegível');
    pass(false, 'Profissional ativo é elegível');
    pass(false, 'cargo Recepção é elegível');
    pass(false, 'contagem por roleId puro (sem role)');
    pass(false, 'usuário inativo é rejeitado');
    pass(false, 'usuário sem cargo é rejeitado');
    pass(false, 'usuário inexistente é rejeitado');
    pass(false, 'assert sem cargo lança mensagem citando "cargo"');
  } else {
    pass(!('STAFF_ELIGIBLE_ROLE_NAMES' in mod), 'lista branca STAFF_ELIGIBLE_ROLE_NAMES removida');
    const eligible = (user: any) => {
      try { mod.assertStaffProfileEligibility(user); return true; } catch { return false; }
    };
    pass(mod.isStaffProfileEligible({ isActive: true, role: { name: 'Admin' } }), 'Admin ativo é elegível');
    pass(mod.isStaffProfileEligible({ isActive: true, role: { name: 'Profissional' } }), 'Profissional ativo é elegível');
    pass(mod.isStaffProfileEligible({ isActive: true, role: { name: 'Recepção' } }), 'cargo Recepção é elegível');
    pass(mod.isStaffProfileEligible({ isActive: true, roleId: 'r1', role: null }), 'contagem por roleId puro (sem role)');
    pass(!mod.isStaffProfileEligible({ isActive: false, role: { name: 'Admin' } }), 'usuário inativo é rejeitado');
    pass(!mod.isStaffProfileEligible({ isActive: true, role: null, roleId: null }), 'usuário sem cargo é rejeitado');
    pass(!mod.isStaffProfileEligible(null), 'usuário inexistente é rejeitado');
    pass(!eligible({ isActive: true, role: null, roleId: null }) &&
         /cargo/i.test(String(captureMessage(() => mod.assertStaffProfileEligibility({ isActive: true, role: null, roleId: null })))),
         'assert sem cargo lança mensagem citando "cargo"');
  }

  // ---------------------------------------------------------------------
  // 2) Integração HTTP (backend real)
  // ---------------------------------------------------------------------
  const token = await login('admin@salao.com', 'admin123');

  // 2a) userId inexistente → 400 com mensagem de usuário inexistente.
  //     (sem validação, o insert estoura FK: 400 mas com mensagem de constraint)
  const ghostId = randomUUID();
  const ghost = await req('/staff', token, {
    method: 'POST',
    body: JSON.stringify({ userId: ghostId, specialties: ['Cabelo'] }),
  });
  pass(ghost.status === 400, 'POST /staff com userId inexistente → 400', String(ghost.status));
  pass(
    /não encontrado|not found/i.test(String(ghost.body?.message ?? '')),
    'POST /staff userId inexistente → mensagem de usuário inexistente',
    String(ghost.body?.message ?? '')
  );

  // 2b-i) negativo: usuário SEM cargo → 400 + não listado
  const noRoleEmail = `verify.norole.${Date.now()}@teste.local`;
  const noRoleUser = await req('/users', token, {
    method: 'POST',
    body: JSON.stringify({ email: noRoleEmail, password: 'verify123', name: 'Verify Sem Cargo' }),
  });
  const noRoleId = noRoleUser.body?.data?.user?.id ?? noRoleUser.body?.data?.id;
  try {
    const res = await req('/staff', token, {
      method: 'POST',
      body: JSON.stringify({ userId: noRoleId, specialties: ['Cabelo'] }),
    });
    pass(res.status === 400, 'POST /staff para usuário sem cargo → 400', String(res.status));
    pass(/cargo/i.test(String(res.body?.message ?? '')), 'mensagem cita o cargo', String(res.body?.message ?? ''));
    const rows = await prisma.staff.count({ where: { userId: noRoleId } });
    pass(rows === 0, 'nenhum perfil criado para usuário sem cargo', `n=${rows}`);
    const listed = await req(`/staff?search=${encodeURIComponent(noRoleEmail)}`, token);
    const listedItems = Array.isArray(listed.body?.data) ? listed.body.data : [];
    pass(!listedItems.some((i: any) => i.user?.email === noRoleEmail),
      'usuário sem cargo NÃO aparece em GET /staff');
  } finally {
    await prisma.notification.deleteMany({ where: { type: 'NEW_USER', message: { contains: noRoleEmail } } });
    await prisma.user.deleteMany({ where: { email: noRoleEmail } });
  }

  // 2b-ii) positivo: usuário COM cargo Recepção → 201 + listado com staff.id real
  const recepRole = await prisma.role.findFirst({ where: { name: 'Recepção' } });
  pass(!!recepRole, 'cargo Recepção existe no banco');
  const recepEmail = `verify.recep.${Date.now()}@teste.local`;
  const recepUser = await req('/users', token, {
    method: 'POST',
    body: JSON.stringify({ email: recepEmail, password: 'verify123', name: 'Verify Recepcao', roleId: recepRole?.id }),
  });
  const recepUserId = recepUser.body?.data?.user?.id ?? recepUser.body?.data?.id;
  try {
    const res = await req('/staff', token, {
      method: 'POST',
      body: JSON.stringify({ userId: recepUserId, specialties: ['Manicure'] }),
    });
    pass(res.status === 201, 'POST /staff para usuário com cargo Recepção → 201', String(res.status));
    const staffId = res.body?.data?.staff?.id;
    const listed = await req(`/staff?search=${encodeURIComponent(recepEmail)}`, token);
    const item = (Array.isArray(listed.body?.data) ? listed.body.data : [])[0];
    pass(!!item && item.hasProfile === true, 'Recepção perfilado aparece com hasProfile=true');
    pass(!!staffId && item?.id === staffId, 'item perfilado usa staff.id real', `id=${item?.id} staffId=${staffId}`);
  } finally {
    await prisma.notification.deleteMany({ where: { type: 'NEW_STAFF', message: { contains: 'Verify Recepcao' } } });
    await prisma.notification.deleteMany({ where: { type: 'NEW_USER', message: { contains: recepEmail } } });
    await prisma.user.deleteMany({ where: { email: recepEmail } }); // cascade Staff.user apaga o perfil
  }

  // ---------------------------------------------------------------------
  // 3) Caminho válido: criação respeita `isAvailable` + item perfilado
  //    usa o staff.id real (id=userId é só para item pendente).
  //    Auto-cleanup aprovado (2026-11-15): apaga SOMENTE o que este gate
  //    criou (usuário verify.*, perfil de staff, notificação NEW_STAFF).
  // ---------------------------------------------------------------------
  const stamp = Date.now();
  const verifyEmail = `verify.staff.${stamp}@teste.local`;

  const rolesRes = await req('/roles', token);
  const roles = Array.isArray(rolesRes.body?.data) ? rolesRes.body.data : [];
  const profissionalRoleId = roles.find((r: any) => r.name === 'Profissional')?.id;
  pass(!!profissionalRoleId, 'cargo Profissional disponível para o usuário de teste');

  const createdUser = await req('/users', token, {
    method: 'POST',
    body: JSON.stringify({
      email: verifyEmail,
      password: 'verify123',
      name: 'Profissional Verify',
      roleId: profissionalRoleId,
    }),
  });
  pass(createdUser.status === 201, 'POST /users cria usuário de teste', String(createdUser.status));

  const userId = createdUser.body?.data?.user?.id ?? createdUser.body?.data?.id;

  if (!userId) {
    pass(false, 'POST /users devolve o id do usuário de teste');
  } else {
    try {
      // Criação com isAvailable=false — RED enquanto o schema/service ignorarem o campo.
      const created = await req('/staff', token, {
        method: 'POST',
        body: JSON.stringify({
          userId,
          specialties: ['Cabelo'],
          isAvailable: false,
        }),
      });
      pass(created.status === 201, 'POST /staff cria perfil para usuário elegível', String(created.status));

      const staffId = created.body?.data?.staff?.id;
      pass(!!staffId, 'POST /staff devolve o staff.id criado', staffId ?? 'n/a');
      pass(
        created.body?.data?.staff?.isAvailable === false,
        'POST /staff respeita isAvailable=false (não fica disponível por default)',
        `isAvailable=${String(created.body?.data?.staff?.isAvailable)}`
      );

      // Item perfilado na listagem usa o staff.id real (id=userId é só do pendente).
      const list = await req(`/staff?search=${encodeURIComponent(verifyEmail)}`, token);
      const listed = (Array.isArray(list.body?.data) ? list.body.data : [])[0];
      pass(!!listed, 'item perfilado aparece na listagem');
      pass(listed?.hasProfile === true, 'item perfilado tem hasProfile=true', String(listed?.hasProfile));
      pass(
        !!staffId && listed?.id === staffId,
        'item perfilado usa o staff.id real (não userId)',
        `id=${listed?.id} staffId=${staffId} userId=${userId}`
      );
      pass(
        listed?.isAvailable === false,
        'listagem reflete isAvailable=false do perfil',
        `isAvailable=${String(listed?.isAvailable)}`
      );
    } finally {
      // Cleanup: notificações NEW_STAFF + perfil + usuário — só o que o gate criou.
      const profile = await prisma.staff.findFirst({ where: { userId } });
      if (profile) {
        await prisma.notification.deleteMany({ where: { dedupeKey: `NEW_STAFF:${profile.id}` } });
        await prisma.staff.deleteMany({ where: { id: profile.id } });
      }
      await prisma.notification.deleteMany({
        where: { type: 'NEW_USER', message: { contains: verifyEmail } },
      });
      await prisma.user.deleteMany({ where: { email: verifyEmail } });
      console.log('CLEANUP | usuário verify.* + perfil + notificação removidos');
    }
  }

  console.log(`\nFALHAS: ${fails}`);
  await prisma.$disconnect();
  process.exit(fails === 0 ? 0 : 1);
})().catch(async (err) => {
  console.error('ERRO no gate:', err);
  await prisma.$disconnect();
  process.exit(2);
});
