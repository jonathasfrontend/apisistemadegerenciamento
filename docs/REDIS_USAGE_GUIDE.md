# 📘 Guia Completo de Uso do Redis

## 🎯 Onde o Redis está e como usar

### 📍 Localização Atual

O Redis está **configurado mas não está sendo utilizado ativamente**. Aqui está onde ele existe:

1. **Infraestrutura:**
   - ✅ Container Docker rodando (porta 6379)
   - ✅ Variável de ambiente `REDIS_URL` configurada
   - ✅ Dependências instaladas (`ioredis`, `bullmq`)

2. **Código preparado:**
   - ✅ `src/jobs/queue.ts` - Sistema de filas configurado
   - ✅ `src/jobs/notification.worker.ts` - Worker criado
   - ❌ **Mas não está sendo usado!**

---

## 🚀 Como Implementar o Redis

### 1️⃣ **Sistema de Filas (Background Jobs)**

#### **O que são filas?**
Filas permitem processar tarefas demoradas em background sem bloquear a requisição HTTP.

#### **Quando usar?**
- ✉️ Enviar emails/WhatsApp
- 💳 Processar pagamentos
- 📊 Gerar relatórios pesados
- 🔔 Enviar notificações agendadas

#### **Como implementar:**

**Passo 1: Iniciar o Worker**

Adicione no `src/server.ts`:

```typescript
import app from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import prisma from './config/db';
import './jobs/notification.worker'; // ← ADICIONAR ESTA LINHA

const startServer = async () => {
  try {
    await prisma.$connect();
    logger.info('✓ Database connected successfully');
    logger.info('✓ Workers started'); // ← ADICIONAR ESTA LINHA

    const server = app.listen(env.port, () => {
      logger.info(`🚀 Server running on port ${env.port}`);
    });
    
    // ... resto do código
  }
};
```

**Passo 2: Usar as Filas nos Services**

Exemplo em `appointments.service.ts`:

```typescript
import { scheduleReminder, addNotificationJob } from '../../../jobs/queue';

export class AppointmentService {
  async create(data: CreateAppointmentInput, createdBy: string) {
    // ... código de criação do appointment
    
    const appointment = await prisma.$transaction(async (tx: any) => {
      const newAppointment = await tx.appointment.create({ data: { ... } });
      
      // ✅ Agendar lembrete 24h antes
      await scheduleReminder(
        newAppointment.id,
        client.phone,
        client.name,
        data.startTime,
        24 // horas antes
      );
      
      // ✅ Enviar confirmação imediata
      await addNotificationJob({
        type: 'whatsapp',
        recipient: client.phone,
        message: `Agendamento confirmado para ${data.startTime}`,
        appointmentId: newAppointment.id
      });
      
      return newAppointment;
    });
    
    return appointment;
  }
}
```

---

### 2️⃣ **Cache de Dados (Melhorar Performance)**

#### **O que é cache?**
Salvar resultados de consultas frequentes na memória (Redis) para evitar consultas repetidas ao banco.

#### **Quando usar?**
- 📋 Listas que mudam pouco (serviços, produtos)
- 👤 Dados de usuário logado
- 📊 Dashboards e relatórios
- 🔍 Buscas frequentes

#### **Como implementar:**

Já criei o serviço `cache.service.ts`. Veja exemplos de uso:

**Exemplo 1: Cache em Listagem de Serviços**

```typescript
// src/api/v1/services/services.service.ts
import { cacheService } from '../../../services/cache.service';

export class ServiceService {
  async findAll() {
    const cacheKey = 'services:all';
    
    // Buscar do cache ou executar consulta
    return await cacheService.getOrSet(
      cacheKey,
      async () => {
        return await prisma.service.findMany({
          where: { isActive: true },
          orderBy: { name: 'asc' }
        });
      },
      3600 // cache por 1 hora
    );
  }

  async update(id: string, data: UpdateServiceInput) {
    const service = await prisma.service.update({
      where: { id },
      data
    });
    
    // ✅ Invalidar cache quando atualizar
    await cacheService.invalidateEntity('services');
    
    return service;
  }
}
```

**Exemplo 2: Cache de Dados do Cliente**

```typescript
// src/api/v1/clients/clients.service.ts
import { cacheService } from '../../../services/cache.service';

export class ClientService {
  async findById(id: string) {
    const cacheKey = `client:${id}`;
    
    return await cacheService.getOrSet(
      cacheKey,
      async () => {
        const client = await prisma.client.findUnique({
          where: { id },
          include: {
            appointments: {
              take: 10,
              orderBy: { startTime: 'desc' }
            }
          }
        });
        
        if (!client) {
          throw new AppError('Client not found', 404);
        }
        
        return client;
      },
      1800 // cache por 30 minutos
    );
  }

  async update(id: string, data: UpdateClientInput) {
    const client = await prisma.client.update({
      where: { id },
      data
    });
    
    // ✅ Invalidar cache específico deste cliente
    await cacheService.del(`client:${id}`);
    
    return client;
  }
}
```

**Exemplo 3: Cache de Dashboard (Métricas)**

```typescript
// src/api/v1/reports/reports.service.ts
import { cacheService } from '../../../services/cache.service';

export class ReportService {
  async getDashboard(date: string) {
    const cacheKey = `dashboard:${date}`;
    
    return await cacheService.getOrSet(
      cacheKey,
      async () => {
        const [appointments, revenue, clients] = await Promise.all([
          prisma.appointment.count({ where: { startTime: { gte: new Date(date) } } }),
          prisma.payment.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
          prisma.client.count({ where: { createdAt: { gte: new Date(date) } } })
        ]);
        
        return { appointments, revenue: revenue._sum.amount || 0, clients };
      },
      300 // cache por 5 minutos
    );
  }
}
```

---

### 3️⃣ **Rate Limiting (Controle de Taxa)**

#### **O que é?**
Limitar número de requisições por IP/usuário para evitar abuso.

#### **Como implementar:**

```typescript
// src/middlewares/rate-limit.ts
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import IORedis from 'ioredis';
import { env } from '../config/env';

const redis = new IORedis(env.redisUrl);

export const apiLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:', // rate limit prefix
  }),
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requisições
  message: 'Muitas requisições deste IP, tente novamente mais tarde.',
});

// Usar nas rotas
router.use('/api', apiLimiter);
```

---

### 4️⃣ **Sessões de Usuário (Opcional)**

#### **O que é?**
Armazenar dados de sessão do usuário logado.

#### **Como implementar:**

```typescript
// src/services/session.service.ts
import { cacheService } from './cache.service';

export class SessionService {
  async createSession(userId: string, token: string) {
    const sessionKey = `session:${userId}`;
    
    await cacheService.set(sessionKey, {
      userId,
      token,
      createdAt: new Date(),
    }, 86400); // 24 horas
  }

  async getSession(userId: string) {
    const sessionKey = `session:${userId}`;
    return await cacheService.get(sessionKey);
  }

  async deleteSession(userId: string) {
    const sessionKey = `session:${userId}`;
    await cacheService.del(sessionKey);
  }
}
```

---

## 📊 Benefícios de Usar Redis

### **Performance:**
- ⚡ Respostas 10-100x mais rápidas (cache em memória vs banco)
- 📉 Redução de carga no PostgreSQL
- 🚀 Melhor experiência do usuário

### **Escalabilidade:**
- 📈 Suportar mais usuários simultâneos
- 🔄 Processamento assíncrono de tarefas
- 💪 Sistema mais robusto

### **Confiabilidade:**
- 🔁 Retry automático em falhas (BullMQ)
- 📝 Histórico de jobs executados
- 🛡️ Proteção contra DDoS (rate limiting)

---

## 🔧 Configuração e Manutenção

### **Monitorar Redis:**

```bash
# Ver status
docker exec -it salao-redis redis-cli INFO

# Ver chaves existentes
docker exec -it salao-redis redis-cli KEYS "*"

# Ver uso de memória
docker exec -it salao-redis redis-cli INFO memory

# Ver filas (BullMQ)
docker exec -it salao-redis redis-cli KEYS "bull:*"
```

### **Limpar Cache:**

```bash
# Limpar todo o cache
docker exec -it salao-redis redis-cli FLUSHDB

# Limpar chaves específicas
docker exec -it salao-redis redis-cli DEL "client:*"
```

### **Monitorar Filas:**

Você pode usar o **Bull Board** para visualizar as filas:

```bash
npm install @bull-board/express @bull-board/api
```

```typescript
// src/app.ts
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { notificationQueue, paymentQueue, reportQueue } from './jobs/queue';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(notificationQueue),
    new BullMQAdapter(paymentQueue),
    new BullMQAdapter(reportQueue),
  ],
  serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());
```

Acesse em: `http://localhost:4000/admin/queues`

---

## 📝 Checklist de Implementação

### **Fase 1: Básico (Fazer Agora)**
- [ ] Adicionar `import './jobs/notification.worker'` no `server.ts`
- [ ] Implementar cache em `services.service.ts` (listagem de serviços)
- [ ] Implementar notificações em `appointments.service.ts`
- [ ] Testar envio de WhatsApp via fila

### **Fase 2: Intermediário**
- [ ] Adicionar cache em `clients.service.ts`
- [ ] Implementar cache de dashboard
- [ ] Criar workers para pagamentos e relatórios
- [ ] Adicionar Bull Board para monitorar filas

### **Fase 3: Avançado**
- [ ] Implementar rate limiting com Redis
- [ ] Cache de autenticação (blacklist de tokens)
- [ ] Implementar pub/sub para notificações em tempo real
- [ ] Configurar Redis Cluster para produção

---

## 🎓 Recursos para Aprender Mais

- **BullMQ Docs:** https://docs.bullmq.io/
- **IORedis Docs:** https://github.com/redis/ioredis
- **Redis Cache Patterns:** https://redis.io/docs/manual/patterns/
- **Bull Board:** https://github.com/felixmosh/bull-board

---

## ⚠️ Importante

1. **Desenvolvimento local:** Use o Redis do Docker Compose
2. **Produção:** Use serviço gerenciado (Redis Labs, AWS ElastiCache)
3. **Cache TTL:** Ajuste conforme necessidade (dados que mudam pouco = TTL maior)
4. **Invalidação:** Sempre invalide cache ao atualizar/deletar dados

---

## 🤝 Precisa de Ajuda?

Se tiver dúvidas sobre implementação específica, me avise! Posso:
- Criar exemplos adicionais
- Ajustar código existente
- Explicar conceitos específicos
- Revisar implementações
