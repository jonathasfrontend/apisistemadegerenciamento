/**
 * [F0B.4] Gestão de empresas + registro público desativado.
 *
 * Roda somente contra o banco de teste (docker-compose.test.yml).
 * Cobertura: CRUD de Companies com permissões companies.*, paginação,
 * toggle isActive, 403 para usuário sem permissão, register público 403
 * sem criar usuário, e companyId adversarial ignorado em POST /users.
 */
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

describe('companies management and public registration off (finance F0B.4)', () => {
  let fixture: TenantFixture;
  let tokenNoPermission: string;
  let createdCompanyId: string;
  let companyName: string;

  beforeAll(async () => {
    fixture = await seedTwoTenants();

    // Usuário autenticado, mas sem nenhuma permissão companies.*.
    const role = await prisma.role.create({
      data: { name: `SemPerm-${fixture.suffix}`, isSystem: false, isActive: true },
    });
    const passwordHash = await bcrypt.hash('teste123', 4);
    const user = await prisma.user.create({
      data: {
        email: `semperm-${fixture.suffix}@test.local`,
        passwordHash,
        name: 'Sem permissão',
        roleId: role.id,
        companyId: fixture.companyAId,
      },
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'teste123' });
    if (login.status !== 200) {
      throw new Error(`Login sem-permissão falhou (${login.status}): ${JSON.stringify(login.body)}`);
    }
    tokenNoPermission = login.body.data.accessToken;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. Admin cria empresa com nome e isActive padrão', async () => {
    companyName = `Empresa Nova ${fixture.suffix}`;
    const res = await request(app)
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ name: companyName, document: '12345678000195', isActive: true });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.id).toEqual(expect.any(String));
    expect(res.body.data.name).toBe(companyName);
    expect(res.body.data.isActive).toBe(true);
    createdCompanyId = res.body.data.id;
  });

  it('2. Admin lista empresas paginado com envelope pagination', async () => {
    const res = await request(app)
      .get('/api/v1/companies?page=1&limit=5')
      .set('Authorization', `Bearer ${fixture.tokenA}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.map((c: { id: string }) => c.id)).toContain(createdCompanyId);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 5 });
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
    expect(res.body.pagination.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('3. Admin busca empresa por id', async () => {
    const res = await request(app)
      .get(`/api/v1/companies/${createdCompanyId}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdCompanyId);
    expect(res.body.data.name).toBe(companyName);
  });

  it('4. Admin atualiza empresa e alterna isActive', async () => {
    const newName = `Empresa Renomeada ${fixture.suffix}`;
    const res = await request(app)
      .put(`/api/v1/companies/${createdCompanyId}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ name: newName, isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe(newName);
    expect(res.body.data.isActive).toBe(false);
    companyName = newName;
  });

  it('5. nome duplicado é rejeitado', async () => {
    const res = await request(app)
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ name: companyName });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/empresa/i);
  });

  it('6. GET de empresa inexistente retorna 404', async () => {
    const res = await request(app)
      .get('/api/v1/companies/00000000-0000-4000-8000-000000000000')
      .set('Authorization', `Bearer ${fixture.tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Empresa não encontrada');
  });

  it('7. usuário sem companies.* recebe 403 em todas as rotas', async () => {
    const getRes = await request(app)
      .get('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenNoPermission}`);
    expect(getRes.status).toBe(403);

    const postRes = await request(app)
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenNoPermission}`)
      .send({ name: `Empresa Negada ${fixture.suffix}` });
    expect(postRes.status).toBe(403);

    const putRes = await request(app)
      .put(`/api/v1/companies/${createdCompanyId}`)
      .set('Authorization', `Bearer ${tokenNoPermission}`)
      .send({ isActive: true });
    expect(putRes.status).toBe(403);
  });

  it('8. POST /auth/register responde 403 e não cria usuário', async () => {
    const before = await prisma.user.count();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `register-${fixture.suffix}@test.local`,
        password: 'teste123',
        name: 'Cadastro público',
      });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Cadastro desativado. Solicite ao administrador.');
    expect(res.body.data).toBeUndefined();
    expect(await prisma.user.count()).toBe(before);
  });

  it('9. Admin da empresa A não cria usuário na empresa B (body adversarial)', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({
        email: `adversarial-${fixture.suffix}@test.local`,
        password: 'teste123',
        name: 'Usuário adversarial',
        companyId: fixture.companyBId,
      });

    expect(res.status).toBe(201);
    const persisted = await prisma.user.findFirst({
      where: { email: `adversarial-${fixture.suffix}@test.local` },
    });
    expect(persisted).not.toBeNull();
    expect(persisted!.companyId).toBe(fixture.companyAId);
    expect(persisted!.companyId).not.toBe(fixture.companyBId);
  });
});
