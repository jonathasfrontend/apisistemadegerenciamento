-- 0B.2 — Provisionamento das permissões companies.* em bancos JÁ EXISTENTES.
--
-- Contexto: as 3 permissões abaixo só eram criadas pelo prisma/seed.ts. Em um
-- banco já provisionado (ex.: Neon) o role Admin não as possui, então a UI
-- esconde o menu "Empresas" e a API responde 403 em /api/v1/companies.
--
-- SEGURANÇA:
--   * Somente INSERT ... ON CONFLICT DO NOTHING. Nenhum DELETE/UPDATE/DROP.
--   * Reexecutar é seguro: não duplica permissões nem vínculos.
--   * NÃO cria roles, NÃO altera vínculos de Recepção/Profissional.
--   * Se não existir role chamado 'Admin', a segunda instrução não faz nada.
--   * NÃO roda seed (o seed faz deleteMany global em role_permissions,
--     permissions e roles — ver prisma/seed.ts:39-41).
--
-- APLICAR SOMENTE COM APROVAÇÃO EXPLÍCITA DO JONATHAS.

-- 1) Permissões (espelham prisma/seed.ts:110-113).
INSERT INTO "permissions" ("id", "name", "description", "module", "created_at")
VALUES
  (gen_random_uuid()::text, 'companies.read',   'Visualizar empresas', 'companies', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'companies.create', 'Criar empresas',      'companies', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'companies.update', 'Editar empresas',     'companies', CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

-- 2) Vínculo com o role Admin existente (se houver).
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid()::text, r."id", p."id", CURRENT_TIMESTAMP
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."name" = 'Admin'
  AND p."name" IN ('companies.read', 'companies.create', 'companies.update')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
