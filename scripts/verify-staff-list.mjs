// Gate: GET /staff lista todo usuário ativo com cargo (com ou sem perfil de staff).
// Pré-condição: backend rodando em :4000, seed aplicado.
// RED = endpoint atual lê só prisma.staff.findMany (admin sem perfil não aparece).
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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

const asItems = (res) => (Array.isArray(res.body?.data) ? res.body.data : []);

(async () => {
  let fails = 0;
  const pass = (ok, label, extra = '') => {
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` | ${extra}` : ''}`);
  };

  const token = await login('admin@salao.com', 'admin123');

  // 0) sem token → 401 (endpoint exige staff.read via authenticate)
  const anon = await req('/staff');
  pass(anon.status === 401, 'GET /staff sem token → 401', String(anon.status));

  // 1) listagem contém admin e recepção (pendente sem perfil); todo item tem cargo válido
  const listRes = await req('/staff', token);
  pass(listRes.status === 200, 'GET /staff status 200', String(listRes.status));
  const items = asItems(listRes);
  pass(items.some((i) => i.user?.email === 'admin@salao.com'), 'admin aparece na listagem');
  const recepcaoItem = items.find((i) => i.user?.email === 'recepcao@salao.com');
  pass(!!recepcaoItem, 'recepção (cargo Recepção, sem perfil) aparece');
  pass(
    !!recepcaoItem && recepcaoItem.hasProfile === false && recepcaoItem.id === recepcaoItem.userId,
    'recepção é item pendente coerente (hasProfile=false, id=userId)',
    recepcaoItem ? `id=${recepcaoItem.id}` : 'ausente'
  );
  pass(
    items.length > 0 && items.every((i) => !!i.role?.name),
    'todo item tem cargo (role.name preenchido)',
    `roles=${[...new Set(items.map((i) => i.role?.name))].join(',')}`
  );

  // 1.1) Invariante: /staff == /users ativos com cargo (pega regressões de 1 e 3 de uma vez)
  const usersRes = await req('/users?isActive=true', token);
  const rawUsers = usersRes.body?.data;
  const expected = new Set(
    (Array.isArray(rawUsers) ? rawUsers : (rawUsers?.users ?? []))
      .filter((u) => !!u.role)
      .map((u) => u.id)
  );
  const got = new Set(items.map((i) => i.userId));
  pass(
    expected.size > 0 &&
      got.size === expected.size &&
      [...expected].every((id) => got.has(id)),
    'GET /staff == GET /users ativos com cargo (sem extra, sem faltando)',
    `esperado=${expected.size} obtido=${got.size}`
  );

  // 2) existe item pendente (usuário com cargo sem perfil) e ele é coerente.
  //    Dinâmico de propósito: não amarra o gate no estado atual do seed.
  const pending = items.find((i) => i.hasProfile === false);
  pass(!!pending, 'existe item pendente na listagem');
  pass(
    !!pending && pending.id === pending.userId,
    'item pendente: id=userId (nunca staff.id)',
    pending ? `id=${pending.id} userId=${pending.userId}` : 'sem pendente'
  );
  pass(
    !!pending &&
      pending.specialties === undefined &&
      pending.commissionType === undefined &&
      pending.commissionValue === undefined &&
      pending.isAvailable === undefined,
    'item pendente: sem campos de perfil (specialties/commission*/isAvailable)'
  );

  // 3) existe ao menos um item perfilado com campos completos
  const profiled = items.filter((i) => i.hasProfile === true);
  pass(
    profiled.length > 0 && profiled.every((i) => Array.isArray(i.specialties) && i.isAvailable !== undefined),
    'itens perfilados têm specialties/isAvailable',
    `perfilados=${profiled.length}/${items.length}`
  );

  // 4) ?isAvailable=true exclui pendentes E só devolve quem está disponível
  //    (o seletor de agendamento usa esse filtro e exige staff.id real)
  const availRes = await req('/staff?isAvailable=true', token);
  const avail = asItems(availRes);
  pass(
    avail.length > 0 && avail.every((i) => i.hasProfile === true),
    '?isAvailable=true só retorna perfilados',
    `n=${avail.length}`
  );
  pass(
    avail.length > 0 && avail.every((i) => i.isAvailable === true),
    '?isAvailable=true só retorna quem está disponível',
    `isAvailable=${[...new Set(avail.map((i) => i.isAvailable))].join(',')}`
  );

  // 5) busca por NOME (pendente e perfilado) — não pode depender do email
  if (pending) {
    const byName = asItems(await req(`/staff?search=${encodeURIComponent(pending.user.name)}`, token));
    pass(
      byName.some((i) => i.user?.email === pending.user.email),
      'busca por nome encontra item pendente',
      `search="${pending.user.name}" n=${byName.length}`
    );
  }

  const profiledOne = profiled[0];
  if (profiledOne) {
    const byName = asItems(
      await req(`/staff?search=${encodeURIComponent(profiledOne.user.name)}`, token)
    );
    pass(
      byName.some((i) => i.user?.email === profiledOne.user.email),
      'busca por nome encontra item perfilado',
      `search="${profiledOne.user.name}" n=${byName.length}`
    );

    // 6) busca por EMAIL
    const byEmail = asItems(
      await req(`/staff?search=${encodeURIComponent(profiledOne.user.email)}`, token)
    );
    pass(
      byEmail.some((i) => i.user?.email === profiledOne.user.email),
      'busca por email encontra item',
      `search="${profiledOne.user.email}" n=${byEmail.length}`
    );
  }

  // 7) Usuário ativo com cargo é listado; deixa de ser listado ao ficar inativo.
  const stamp = Date.now();
  const email = `verify.list.${stamp}@teste.local`;
  const rolesRes = await req('/roles', token);
  const recepcaoRole = (Array.isArray(rolesRes.body?.data) ? rolesRes.body.data : [])
    .find((r) => r.name === 'Recepção');
  pass(!!recepcaoRole, 'cargo Recepção existe no banco');
  let fixtureId = null;
  try {
    const created = await req('/users', token, {
      method: 'POST',
      body: JSON.stringify({ email, password: 'verify123', name: `Verify List ${stamp}`, roleId: recepcaoRole?.id }),
    });
    fixtureId = created.body?.data?.user?.id ?? created.body?.data?.id;
    pass(created.status === 201 && !!fixtureId, 'fixture ativo com cargo criado', String(created.status));
    const listed = asItems(await req(`/staff?search=${encodeURIComponent(email)}`, token));
    pass(listed.some((i) => i.user?.email === email), 'fixture ativo com cargo aparece no /staff');
    const deact = await req(`/users/${fixtureId}/deactivate`, token, { method: 'PUT' });
    pass(deact.status === 200 || deact.status === 204, 'PUT deactivate aceito', String(deact.status));
    const after = asItems(await req(`/staff?search=${encodeURIComponent(email)}`, token));
    pass(!after.some((i) => i.user?.email === email), 'usuário inativo deixa de aparecer no /staff');
  } finally {
    // Ordem de FK: notificação (user SetNull) → usuário. Fixture não tem perfil.
    if (fixtureId) {
      await prisma.notification.deleteMany({ where: { type: 'NEW_USER', message: { contains: email } } });
      const del = await prisma.user.deleteMany({ where: { id: fixtureId } });
      pass(del.count > 0, 'cleanup removeu o fixture', `fixture=${fixtureId} count=${del.count}`);
    }
  }

  // Resíduo: nenhum fixture DESTE run pode sobrar no banco.
  const residue = await prisma.user.count({ where: { email } });
  pass(residue === 0, 'resíduo: fixture verify.list removido do banco', `residue=${residue}`);

  console.log(`\nFALHAS: ${fails}`);
  await prisma.$disconnect();
  process.exit(fails === 0 ? 0 : 1);
})();
