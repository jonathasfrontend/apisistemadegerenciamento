import { Router } from 'express';

// Módulos F1+: cada subpasta nasce com .routes/.controller/.service/.schemas
// na fase que a implementa. Registrar o mount `/api/v1/finance` em app.ts
// somente quando o primeiro módulo tiver rotas reais (F1).
const router = Router();

export default router;
