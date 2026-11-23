/**
 * [F1.1c] Helpers compartilhados pelos cadastros financeiros.
 *
 * Mantém um único ponto de verdade para paginação, ordenação e filtro
 * `isActive`. `companyId` nunca vem da query: todos os services recebem o
 * valor recarregado do banco em `req.user` (F0.2).
 */
import { AppError } from '../../../middlewares/error.handler';
import { parseLimit, parsePage } from '../../../utils/pagination';

export interface ListParams {
  page: number;
  limit: number;
  isActive?: boolean;
  field: string;
  direction: 'asc' | 'desc';
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function buildPagination(page: number, limit: number, total: number): Pagination {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}

/** Interpreta `?isActive=` e `?sort=campo:desc` com fallback seguro. */
export function parseListParams(
  query: Record<string, unknown>,
  allowedFields: readonly string[],
  fallbackField = 'createdAt'
): ListParams {
  const page = parsePage(query.page);
  const limit = parseLimit(query.limit);

  let isActive: boolean | undefined;
  if (query.isActive === 'true' || query.isActive === '1') isActive = true;
  else if (query.isActive === 'false' || query.isActive === '0') isActive = false;
  else if (query.isActive !== undefined && query.isActive !== '') {
    throw new AppError('isActive deve ser true ou false', 400);
  }

  const [requestedField, direction] = String(query.sort ?? `${fallbackField}:desc`).split(':');
  const field = allowedFields.includes(requestedField) ? requestedField : fallbackField;

  return { page, limit, isActive, field, direction: direction === 'asc' ? 'asc' : 'desc' };
}

/** Construtor de `orderBy` tipado frouxamente de propósito: cada modelo tem o seu. */
export function orderBy(params: ListParams): Record<string, 'asc' | 'desc'> {
  return { [params.field]: params.direction };
}

/** uppercase + NFD sem diacríticos — usado em `Acquirer.bankKeywords`. */
export function normalizeKeyword(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}
