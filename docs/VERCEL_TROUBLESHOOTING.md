# 🔧 Troubleshooting - Deploy Vercel

## Problemas Comuns e Soluções

### ❌ Erro: "ENOENT: no such file or directory, mkdir 'logs'"

**Causa:** Winston tentando criar diretório em ambiente serverless.

**Solução:** ✅ JÁ CORRIGIDO
- O `logger.ts` foi atualizado para detectar ambiente Vercel
- Usa apenas console em produção/serverless

**Verificar:** 
```typescript
// src/utils/logger.ts deve ter:
if (env.nodeEnv === 'development' || process.env.VERCEL !== '1') {
  // File transports apenas em dev
}
```

---

### ❌ Erro: 500 Internal Server Error para favicon

**Causa:** Falta de tratamento para requisições de favicon.

**Solução:** ✅ JÁ CORRIGIDO
- Rotas adicionadas em `app.ts` retornando 204

**Verificar:**
```typescript
// src/app.ts deve ter:
app.get('/favicon.ico', (_req, res) => res.status(204).end());
app.get('/favicon.png', (_req, res) => res.status(204).end());
```

---

### ❌ Erro: "Cannot find module" no deploy

**Causa:** Dependências não instaladas ou build incompleto.

**Soluções:**

1. Verificar `package.json` tem os scripts corretos:
```json
"scripts": {
  "postinstall": "prisma generate",
  "vercel-build": "prisma generate && prisma migrate deploy && npm run build"
}
```

2. Limpar cache da Vercel:
```bash
vercel --force
```

3. Verificar todas as dependências estão em `dependencies` (não em `devDependencies`):
```bash
npm install --save prisma @prisma/client
```

---

### ❌ Erro: "Prisma Client could not be generated"

**Causa:** Prisma não foi gerado após instalação.

**Soluções:**

1. Adicionar no `package.json`:
```json
"postinstall": "prisma generate"
```

2. Verificar se `prisma/schema.prisma` está no repositório

3. Rodar localmente:
```bash
npx prisma generate
npm run build
```

---

### ❌ Erro: "Database connection failed"

**Causa:** `DATABASE_URL` não configurada ou incorreta.

**Soluções:**

1. Verificar variável de ambiente na Vercel:
   - Dashboard → Projeto → Settings → Environment Variables
   - Adicionar `DATABASE_URL`

2. Formato correto da connection string:
```
postgresql://user:password@host:port/database?schema=public
```

3. Verificar se banco aceita conexões externas:
   - Whitelist IP da Vercel (ou permitir todas: 0.0.0.0/0)
   - Verificar SSL: adicionar `?sslmode=require` se necessário

---

### ❌ Erro: "Function execution timed out"

**Causa:** Função excedeu o tempo limite (10s Hobby / 30s configurado).

**Soluções:**

1. Otimizar queries do banco:
```typescript
// Use select específico
const users = await prisma.user.findMany({
  select: { id: true, name: true, email: true }
});

// Use indices no banco
// Adicione @@ index([fieldName]) no schema.prisma
```

2. Adicionar paginação:
```typescript
const { page = 1, limit = 10 } = req.query;
const skip = (page - 1) * limit;

const results = await prisma.model.findMany({
  skip,
  take: limit
});
```

3. Implementar cache com Redis (Upstash):
```typescript
// Verificar cache antes de query
const cached = await redis.get(key);
if (cached) return JSON.parse(cached);
```

---

### ❌ Erro: "Too Many Requests" (429)

**Causa:** Rate limit atingido.

**Soluções:**

1. Ajustar rate limit em `app.ts`:
```typescript
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests
});
```

2. Implementar rate limit por usuário (não por IP):
```typescript
import rateLimit from 'express-rate-limit';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip,
});
```

---

### ❌ Erro: CORS

**Causa:** Frontend não autorizado.

**Soluções:**

1. Configurar CORS na Vercel (variável de ambiente):
```
CORS_ORIGINS=https://seu-frontend.vercel.app,https://www.seusite.com
```

2. Verificar `app.ts`:
```typescript
app.use(cors({
  origin: env.corsOrigins.split(','),
  credentials: true,
}));
```

3. Para desenvolvimento, permitir temporariamente:
```typescript
app.use(cors({ origin: '*' })); // APENAS PARA TESTES
```

---

### ❌ Erro: "Module not found: @prisma/client"

**Causa:** Prisma Client não gerado no build.

**Soluções:**

1. Verificar script `vercel-build` em `package.json`:
```json
"vercel-build": "prisma generate && npm run build"
```

2. Adicionar `prisma` como dependência (não devDependency):
```bash
npm install --save prisma @prisma/client
```

3. Forçar rebuild:
```bash
vercel --force --prod
```

---

### ❌ Logs não aparecem na Vercel

**Causa:** Logger configurado incorretamente.

**Solução:** ✅ JÁ CORRIGIDO
- Logger usa `console` em produção

**Alternativa - Usar console.log diretamente:**
```typescript
// Em produção, preferir:
console.log('Info:', data);
console.error('Error:', error);
```

---

### ❌ Variáveis de ambiente não carregam

**Causa:** Variáveis não configuradas ou deploy antigo.

**Soluções:**

1. Verificar variáveis na Vercel:
   - Settings → Environment Variables
   - Selecionar ambiente: Production, Preview, Development

2. Redeployar após adicionar variáveis:
```bash
vercel --prod
```

3. Verificar se `.env.example` tem todas as variáveis necessárias

---

## 🔍 Como Debugar

### 1. Ver Logs em Tempo Real
```bash
vercel logs --follow
```

### 2. Ver Logs de um Deploy Específico
1. Acesse: https://vercel.com/dashboard
2. Seu Projeto → Deployments
3. Clique no deployment
4. Aba "Functions" → Expandir função

### 3. Testar Localmente com Vercel CLI
```bash
vercel dev
```

### 4. Rodar Build Localmente
```bash
npm run build
node dist/server.js
```

### 5. Verificar Variáveis de Ambiente
```bash
vercel env ls
```

---

## ✅ Checklist de Debug

- [ ] Logs da Vercel verificados
- [ ] Variáveis de ambiente configuradas
- [ ] `DATABASE_URL` está correta
- [ ] Build local funciona (`npm run build`)
- [ ] Prisma Client gerado (`npx prisma generate`)
- [ ] Migrations aplicadas no banco de produção
- [ ] CORS configurado corretamente
- [ ] Rate limit não está bloqueando
- [ ] Timeout não está sendo atingido
- [ ] Dependências estão instaladas

---

## 📞 Suporte

Se os problemas persistirem:

1. **Logs Detalhados:** Capture screenshot dos logs completos
2. **Erro Específico:** Anote mensagem de erro exata
3. **Contexto:** O que estava tentando fazer quando erro ocorreu
4. **Ambiente:** Production, Preview ou Development

### Recursos Úteis
- [Vercel Status](https://www.vercel-status.com/)
- [Vercel Community](https://github.com/vercel/vercel/discussions)
- [Prisma Docs](https://www.prisma.io/docs)

---

**Última atualização:** 22/12/2025
