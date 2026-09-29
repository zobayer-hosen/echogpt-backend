import { Paginated } from '../dto/paginated-response.dto';
import { PaginationQueryDto } from '../dto/pagination-query.dto';

export const pageOffset = (query: PaginationQueryDto): number =>
  (query.page - 1) * query.limit;

export function toPage<T>(
  data: T[],
  total: number,
  query: PaginationQueryDto,
): Paginated<T> {
  return {
    data,
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
  };
}

/** Escapes `%`, `_` and `\` for use inside a LIKE pattern. */
export const escapeLike = (value: string): string =>
  value.replace(/[\\%_]/g, (char) => `\\${char}`);
