# 🚀 Guia Rápido de Início

## Passo a Passo para Começar

### 1️⃣ Pré-requisitos
- Node.js 18+ instalado
- PostgreSQL instalado e rodando
- Redis instalado (opcional, para jobs)

### 2️⃣ Configurar Banco de Dados

Crie um arquivo `.env` na raiz do projeto:

```env
# Database
DATABASE_URL="postgresql://usuario:senha@localhost:5432/salao_db?schema=public"

# JWT
JWT_SECRET="seu-secret-super-seguro-aqui"
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="30d"

# Server
PORT=4000
NODE_ENV="development"

# CORS
CORS_ORIGINS="http://localhost:3000,http://localhost:5173"

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Redis (opcional)
REDIS_URL="redis://localhost:6379"

# Email (opcional)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_USER="seu-email@gmail.com"
SMTP_PASS="sua-senha"

# WhatsApp (opcional)
WHATSAPP_API_URL="https://api.whatsapp.com"
WHATSAPP_TOKEN="seu-token"

# Payment Gateway (opcional)
PAYMENT_GATEWAY_KEY="sua-chave"
```

### 3️⃣ Instalar Dependências

```bash
npm install
```

### 4️⃣ Gerar Prisma Client

```bash
npm run prisma:generate
```

### 5️⃣ Executar Migrations

```bash
npm run prisma:migrate
```

### 6️⃣ Popular Banco de Dados (Seed)

Crie dados iniciais executando:

```bash
npm run prisma:seed
```

### 7️⃣ Iniciar Servidor em Desenvolvimento

```bash
npm run dev
```

O servidor estará rodando em: `http://localhost:4000`

---

## 🧪 Testando a API

### Opção 1: cURL

```bash
# 1. Fazer Login
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@salao.com",
    "password": "admin123"
  }'

# Resposta (copie o accessToken):
{
  "status": "success",
  "data": {
    "user": { ... },
    "accessToken": "eyJhbGc...",
    "refreshToken": "abc123..."
  }
}

# 2. Listar Serviços (substitua SEU_TOKEN)
curl -X GET http://localhost:4000/api/v1/services \
  -H "Authorization: Bearer SEU_TOKEN"

# 3. Criar um Serviço
curl -X POST http://localhost:4000/api/v1/services \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Corte Masculino",
    "description": "Corte completo",
    "durationMinutes": 30,
    "price": 50,
    "category": "cabelo"
  }'
```

### Opção 2: Postman/Insomnia

1. **Criar nova Request Collection**
2. **Configurar variável de ambiente:**
   - `baseUrl`: `http://localhost:4000/api/v1`
   - `token`: (será preenchido após login)

3. **Criar Request de Login:**
   ```
   POST {{baseUrl}}/auth/login
   Body (JSON):
   {
     "email": "admin@salao.com",
     "password": "admin123"
   }
   ```

4. **Salvar o token retornado**

5. **Criar outras requests** usando o token:
   ```
   Headers:
   Authorization: Bearer {{token}}
   ```

---

## 📋 Checklist de Configuração

- [ ] PostgreSQL instalado e rodando
- [ ] Arquivo `.env` criado e configurado
- [ ] Dependências instaladas (`npm install`)
- [ ] Prisma Client gerado (`npm run prisma:generate`)
- [ ] Migrations executadas (`npm run prisma:migrate`)
- [ ] Seed executado (opcional, `npm run prisma:seed`)
- [ ] Servidor iniciado (`npm run dev`)
- [ ] Primeiro login testado
- [ ] Primeira rota testada

---

## 🐛 Troubleshooting

### Erro de Conexão com Banco
```
Error: P1001: Can't reach database server
```
**Solução**: Verifique se o PostgreSQL está rodando e se a `DATABASE_URL` está correta.

### Erro de Prisma Client
```
Error: @prisma/client did not initialize yet
```
**Solução**: Execute `npm run prisma:generate`

### Erro de JWT
```
Error: JWT secret is not defined
```
**Solução**: Adicione `JWT_SECRET` no arquivo `.env`

### Porta já em uso
```
Error: Port 4000 is already in use
```
**Solução**: Altere a porta no `.env` ou mate o processo que está usando:
```bash
# Windows PowerShell
Get-Process -Id (Get-NetTCPConnection -LocalPort 4000).OwningProcess | Stop-Process
```

---

## 📚 Endpoints Mais Usados

### Autenticação
```
POST /api/v1/auth/login
POST /api/v1/auth/refresh
GET  /api/v1/auth/me
```

### Clientes
```
GET  /api/v1/clients
POST /api/v1/clients
GET  /api/v1/clients/:id
```

### Agendamentos
```
GET  /api/v1/appointments
POST /api/v1/appointments
GET  /api/v1/appointments/availability
```

### Serviços
```
GET  /api/v1/services
POST /api/v1/services
```

### Profissionais
```
GET  /api/v1/staff
POST /api/v1/staff
GET  /api/v1/staff/:id/availability
```

### Pagamentos
```
GET  /api/v1/payments
POST /api/v1/payments
POST /api/v1/payments/:id/confirm
```

### Relatórios
```
GET /api/v1/reports/dashboard
GET /api/v1/reports/financial
```

---

## 🎯 Fluxo Típico de Uso

### 1. Configuração Inicial
```
1. Fazer login como admin
2. Criar serviços
3. Criar perfis de profissionais
4. Configurar horários dos profissionais
```

### 2. Operação Diária
```
1. Cadastrar cliente (se novo)
2. Verificar disponibilidade
3. Criar agendamento
4. Registrar pagamento
5. Confirmar pagamento
```

### 3. Gestão
```
1. Consultar dashboard
2. Gerar relatórios
3. Verificar comissões
4. Controlar estoque
5. Gerenciar despesas
```

---

## 🔐 Usuários Padrão (se seed executado)

```javascript
// Admin
{
  email: "admin@salao.com",
  password: "admin123",
  role: "ADMIN"
}

// Recepção
{
  email: "recepcao@salao.com",
  password: "reception123",
  role: "RECEPTION"
}

// Profissional
{
  email: "profissional@salao.com",
  password: "staff123",
  role: "STAFF"
}
```

---

## 📖 Documentação Completa

- **RESUMO_FINAL.md** - Resumo completo da implementação
- **ROTAS_IMPLEMENTADAS.md** - Lista de todas as rotas
- **IMPLEMENTACAO_COMPLETA.md** - Guia de implementação
- **API_EXAMPLES.md** - Exemplos de uso
- **back-end.md** - Arquitetura do sistema

---

## 🆘 Precisa de Ajuda?

1. Verifique a documentação nos arquivos `.md`
2. Confira os logs do servidor no terminal
3. Use o Prisma Studio para visualizar o banco: `npm run prisma:studio`
4. Verifique se todas as variáveis de ambiente estão configuradas

---

## ✅ Tudo Pronto!

Se todos os passos foram concluídos, sua API está funcionando! 🎉

Acesse: `http://localhost:4000/health` para verificar o status.

---

**Última atualização**: 1 de dezembro de 2025
