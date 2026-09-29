import { ApiProperty } from '@nestjs/swagger';

export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}

/** `{ data: [...], meta: { page, limit, total, totalPages } }` (PRD §6). */
export interface Paginated<T> {
  data: T[];
  meta: PaginationMetaDto;
}
