// Gate "Redis fora do ar": POST /appointments não pode pendurar.
// Pré-condição: Redis (6379) FORA e backend rodando.
// PASS = status 201/200 em < 5000ms (enqueue tem timeout de 2s catchado).
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

(async () => {
  let fails = 0;
  const pass = (ok, label, extra = '') => {
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${extra ? ` | ${extra}` : ''}`);
  };

  const token = await login('admin@salao.com', 'admin123');

  // 1) GETs básicos com Redis fora
  for (const route of ['/auth/me', '/notifications?page=1&limit=5', '/appointments?startDate=2026-11-01&endDate=2026-11-30']) {
    const t0 = Date.now();
    const r = await req(route, token);
    const ms = Date.now() - t0;
    pass(r.status === 200 && ms < 5000, `GET ${route}`, `${r.status} em ${ms}ms`);
  }

  // 2) POST /appointments — o caminho que enfileira aviso de horário
  const clients = await req('/clients?limit=1', token);
  const staff = await req('/staff?limit=1', token);
  const services = await req('/services?limit=1', token);
  const clientId = clients.body.data?.items?.[0]?.id ?? clients.body.data?.[0]?.id;
  const staffId = staff.body.data?.items?.[0]?.id ?? staff.body.data?.[0]?.id;
  const svc = services.body.data?.items?.[0] ?? services.body.data?.[0];

  if (!clientId || !staffId || !svc) {
    console.log(`FAIL | não consegui montar payload (client=${clientId} staff=${staffId} svc=${!!svc})`);
    process.exit(1);
  }

  const startTime = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const payload = {
    clientId,
    staffId,
    startTime,
    services: [{ id: svc.id, name: svc.name, price: svc.price, duration: svc.durationMinutes ?? svc.duration ?? 30 }],
    notes: 'gate-redis-down (limpar após)',
  };

  const t0 = Date.now();
  const r = await req('/appointments', token, { method: 'POST', body: JSON.stringify(payload) });
  const ms = Date.now() - t0;
  const created = r.body?.data?.id ?? r.body?.id;
  pass(
    (r.status === 201 || r.status === 200) && ms < 5000,
    'POST /appointments com Redis fora',
    `${r.status} em ${ms}ms${created ? ` | id=${created}` : ''}`
  );
  console.log(`\nAPPOINTMENT_GATE_ID=${created ?? 'N/A'}`);
  console.log(`\nFALHAS: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
})();
