import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { PaginationMetaDto } from '../dto/paginated-response.dto';

/** Documents `{ data: Model[], meta }` for a list endpoint. */
export const ApiPaginatedResponse = <TModel extends Type<unknown>>(
  model: TModel,
  description = 'One page of results',
) =>
  applyDecorators(
    ApiExtraModels(model, PaginationMetaDto),
    ApiOkResponse({
      description,
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          meta: { $ref: getSchemaPath(PaginationMetaDto) },
        },
      },
    }),
  );
