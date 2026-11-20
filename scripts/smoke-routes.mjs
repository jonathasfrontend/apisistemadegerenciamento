// Varredura de rotas autenticadas: confirma que nada quebrou depois dos fixes.
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

async function req(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
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

const ROUTES = [
  '/auth/me',
  '/clients?page=1&limit=5',
  '/clients?search=a&limit=3',
  '/clients/export',
  '/staff?limit=5',
  '/staff?search=a',
  '/services?limit=5',
  '/services?search=c',
  '/services?limit=0',
  '/products?limit=5',
  '/products?search=cad',
  '/appointments?startDate=2026-11-01&endDate=2026-11-30',
  '/payments?status=PENDING',
  '/notifications?page=1&limit=20',
  '/notifications/unread-count',
  '/roles',
  '/roles/permissions',
  '/waitlist',
  '/sales',
  '/expenses',
  '/reviews',
  '/reviews/stats',
  '/reports/financial/revenue?startDate=2026-11-01&endDate=2026-11-30',
  '/reports/financial/complete?startDate=2026-11-01&endDate=2026-11-30',
  '/reports/appointments/stats?startDate=2026-11-01&endDate=2026-11-30',
  '/reports/dashboard',
  '/reports/clients/analysis?startDate=2026-11-01&endDate=2026-11-30',
  '/reports/products/low-stock',
  '/reports/commissions',
];

(async () => {
  const admin = await login('admin@salao.com', 'admin123');
  const reception = await login('recepcao@salao.com', 'reception123');

  let fails = 0;

  console.log('--- ADMIN ---');
  for (const route of ROUTES) {
    const r = await req(route, admin);
    const ok = r.status === 200;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${route} | ${r.status}${ok ? '' : ` | ${JSON.stringify(r.body).slice(0, 120)}`}`);
  }

  console.log('\n--- RECEPÇÃO (permissões negativas esperadas) ---');
  const neg = await req('/clients/export', reception);
  const exportBlocked = neg.status === 403;
  if (!exportBlocked) fails++;
  console.log(`${exportBlocked ? 'PASS' : 'FAIL'} | /clients/export bloqueado para recepção | ${neg.status}`);

  const me = await req('/auth/me', reception);
  console.log(`${me.status === 200 ? 'PASS' : 'FAIL'} | /auth/me como recepção | ${me.status}`);

  console.log(`\nFALHAS: ${fails}`);
})();
