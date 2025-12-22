# Guia de Deploy na Vercel - Correções Aplicadas

## 🔧 Problemas Corrigidos

### 1. **Erro de Criação de Diretório 'logs'**
**Problema:** O Winston tentava criar o diretório 'logs' no filesystem, o que não é permitido em ambientes serverless como a Vercel.

**Solução:** Modificado `src/utils/logger.ts` para:
- Detectar se está rodando na Vercel (`process.env.VERCEL === '1'`)
- Usar apenas `Console` transport em produção/Vercel
- Manter `File` transports apenas em desenvolvimento local
- Adicionar tratamento de erros com fallback para console

### 2. **Erros 500 para Favicon**
**Problema:** Requisições para `/favicon.ico` e `/favicon.png` geravam erros 500.

**Solução:** Adicionado em `src/app.ts`:
- Rotas específicas para favicon retornando status 204 (No Content)
- Previne logs de erro desnecessários

### 3. **Configuração da Vercel Ausente**
**Problema:** Faltava configuração adequada para deploy serverless.

**Solução:** Criados arquivos:
- `vercel.json` - Configuração principal do deploy
- `.vercelignore` - Arquivos a serem ignorados no deploy

### 4. **Adaptação do Server.ts**
**Problema:** O arquivo `server.ts` sempre tentava iniciar um servidor HTTP.

**Solução:** Modificado para:
- Exportar o app Express diretamente (necessário para Vercel)
- Iniciar servidor HTTP apenas em ambiente local
- Detectar ambiente Vercel e ajustar comportamento

## 📝 Arquivos Modificados

### `src/utils/logger.ts`
```typescript
// Agora detecta ambiente e configura transportes adequadamente
// Vercel: apenas Console
// Local: Console + File
```

### `src/app.ts`
```typescript
// Adicionadas rotas para favicon
app.get('/favicon.ico', (_req, res) => res.status(204).end());
app.get('/favicon.png', (_req, res) => res.status(204).end());
```

### `src/server.ts`
```typescript
// Exporta app e inicia servidor apenas se não estiver na Vercel
export default app;
if (process.env.VERCEL !== '1') {
  startServer();
}
```

### `vercel.json` (NOVO)
```json
{
  "version": 2,
  "builds": [{ "src": "src/server.ts", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "src/server.ts" }],
  "env": { "NODE_ENV": "production" },
  "regions": ["iad1"],
  "functions": { "src/server.ts": { "maxDuration": 30 } }
}
```

### `.vercelignore` (NOVO)
Lista de arquivos/pastas ignorados no deploy.

## 🚀 Como Fazer o Deploy

### Pré-requisitos
1. Conta na Vercel (https://vercel.com)
2. Vercel CLI instalado: `npm i -g vercel`
3. Variáveis de ambiente configuradas na Vercel

### Configurar Variáveis de Ambiente na Vercel

Acesse o dashboard do projeto na Vercel e adicione:

```bash
DATABASE_URL=sua_connection_string_do_banco
JWT_SECRET=seu_jwt_secret
CORS_ORIGINS=https://seu-frontend.vercel.app
NODE_ENV=production
PORT=3000

# Outras variáveis necessárias
STRIPE_SECRET_KEY=...
REDIS_URL=...
# etc...
```

### Deploy via CLI

```bash
# 1. Login na Vercel
vercel login

# 2. Deploy (primeira vez)
vercel

# 3. Deploy para produção
vercel --prod
```

### Deploy via GitHub

1. Conecte seu repositório no dashboard da Vercel
2. Configure as variáveis de ambiente
3. Cada push na branch `main` fará deploy automático

## ⚙️ Configurações Importantes

### Banco de Dados
- Use um banco de dados hospedado (não local)
- Recomendado: 
  - **Supabase** (PostgreSQL gratuito)
  - **PlanetScale** (MySQL serverless)
  - **Railway** (PostgreSQL)
  - **Neon** (PostgreSQL serverless)

### Prisma
Certifique-se de ter no `package.json`:
```json
{
  "scripts": {
    "postinstall": "prisma generate",
    "vercel-build": "prisma generate && prisma migrate deploy"
  }
}
```

### Redis (se usar)
- Use Redis hospedado: **Upstash**, **Redis Labs**, ou **Railway**
- Não use Redis local

## 🧪 Testar Localmente

```bash
# Instalar dependências
npm install

# Gerar Prisma Client
npx prisma generate

# Rodar migrações
npx prisma migrate dev

# Iniciar servidor local
npm run dev
```

## 📊 Verificar Deploy

Após o deploy, teste:

```bash
# Health check
curl https://sua-api.vercel.app/health

# Teste de rota API
curl https://sua-api.vercel.app/api/v1/auth/login
```

## ⚠️ Limitações da Vercel (Plan Gratuito)

- **Timeout:** 10 segundos para Hobby, 30 segundos configurado no vercel.json
- **Tamanho:** Máximo 250MB por deploy
- **Invocações:** 100GB-Horas/mês
- **Região:** Configurado para `iad1` (pode mudar no vercel.json)

## 🔍 Monitoramento de Erros

Acesse os logs na Vercel:
1. Dashboard → Seu Projeto → Deployments
2. Clique no deployment
3. Aba "Functions" → Ver logs em tempo real

## 📚 Recursos Adicionais

- [Vercel Documentation](https://vercel.com/docs)
- [Deploying Express Apps](https://vercel.com/guides/using-express-with-vercel)
- [Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)
- [Serverless Functions](https://vercel.com/docs/concepts/functions/serverless-functions)

## ✅ Checklist de Deploy

- [ ] Variáveis de ambiente configuradas na Vercel
- [ ] Banco de dados hospedado e acessível
- [ ] `DATABASE_URL` aponta para banco de produção
- [ ] Migrations aplicadas no banco de produção
- [ ] `vercel.json` configurado
- [ ] Build local funcionando (`npm run build`)
- [ ] Testes passando
- [ ] CORS configurado para domínio do frontend
- [ ] Deploy realizado
- [ ] Health check respondendo
- [ ] Rotas API testadas

---

**Data:** 22 de dezembro de 2025
**Status:** ✅ Correções aplicadas e prontas para deploy
