import { Router } from 'express';

import settingsRoutes from './settings/settings.routes';
import categoriesRoutes from './categories/categories.routes';
import suppliersRoutes from './suppliers/suppliers.routes';
import bankAccountsRoutes from './bank-accounts/bank-accounts.routes';
import acquirersRoutes from './acquirers/acquirers.routes';
import cashRoutes from './cash/cash.routes';
import cardReceivablesRoutes from './card-receivables/card-receivables.routes';
import payablesRoutes from './payables/payables.routes';
import receivablesRoutes from './receivables/receivables.routes';
import otherIncomesRoutes from './other-incomes/other-incomes.routes';

// F1.1c: cadastros e caixas registradas. Módulos F2/F3 entram aqui quando
// implementados; cada subpasta mantém .routes/.controller/.service/.schemas.
const router = Router();

router.use('/settings', settingsRoutes);
router.use('/categories', categoriesRoutes);
router.use('/suppliers', suppliersRoutes);
router.use('/bank-accounts', bankAccountsRoutes);
router.use('/acquirers', acquirersRoutes);
router.use('/cash', cashRoutes);
router.use('/card-receivables', cardReceivablesRoutes);
router.use('/payables', payablesRoutes);
router.use('/receivables', receivablesRoutes);
router.use('/other-incomes', otherIncomesRoutes);

export default router;
