import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-codes';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { HealthStatus } from '../../common/enums/health-status.enum';
import { ProviderType } from '../../common/enums/provider-type.enum';
import { UsageFeature } from '../../common/enums/usage-feature.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { decrypt, encrypt } from '../../common/utils/crypto.util';
import { pageOffset, toPage } from '../../common/utils/pagination.util';
import { RequestContext } from '../../common/utils/request-context';
import { lastFour, maskKey } from '../../common/utils/text.util';
import { AppConfig } from '../../config/configuration';
import { ApiUsageLogService } from '../logging/api-usage-log.service';
import { AdapterFactory } from './adapters/adapter.factory';
import { AiProviderAdapter } from './adapters/ai-provider-adapter.interface';
import {
  AdminProviderDto,
  CreateProviderDto,
  HealthCheckResultDto,
  ProviderDto,
  UpdateProviderDto,
} from './dto/provider.dto';
import { AiProvider } from './entities/ai-provider.entity';

const PG_UNIQUE_VIOLATION = '23505';

export interface ResolvedProvider {
  provider: AiProvider;
  adapter: AiProviderAdapter;
}

/** Owns `ai_providers`: CRUD, keys, default, health, and adapters for callers. */
@Injectable()
export class ProvidersService {
  private readonly encryptionKey: string;

  constructor(
    @InjectRepository(AiProvider)
    private readonly providers: Repository<AiProvider>,
    private readonly dataSource: DataSource,
    private readonly factory: AdapterFactory,
    private readonly usageLogs: ApiUsageLogService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.encryptionKey = config.get('crypto.encryptionKey', { infer: true });
  }

  // ---- for users and other modules ----

  async listEnabled(): Promise<ProviderDto[]> {
    const rows = await this.providers.find({
      where: { isEnabled: true },
      order: { isDefault: 'DESC', name: 'ASC' },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      model: p.model,
      isDefault: p.isDefault,
    }));
  }

  /**
   * The provider to call for chat/search: the given one or the default.
   * Unknown → 404, disabled → 409 PROVIDER_DISABLED (PRD CH-3).
   */
  async resolveForUse(providerId?: string): Promise<ResolvedProvider> {
    const qb = this.providers
      .createQueryBuilder('p')
      .addSelect('p.apiKeyEncrypted');
    const provider = providerId
      ? await qb.where('p.id = :providerId', { providerId }).getOne()
      : await qb.where('p.is_default').getOne();

    if (!provider) {
      if (providerId) {
        throw AppException.notFound('Provider');
      }
      throw this.disabled('No default AI provider is configured');
    }
    if (!provider.isEnabled) {
      throw this.disabled(`Provider "${provider.name}" is disabled`);
    }
    return { provider, adapter: this.adapterFor(provider) };
  }

  // ---- admin ----

  async listForAdmin(
    query: PaginationQueryDto,
  ): Promise<Paginated<AdminProviderDto>> {
    const [rows, total] = await this.providers.findAndCount({
      order: { isDefault: 'DESC', name: 'ASC' },
      skip: pageOffset(query),
      take: query.limit,
    });
    return toPage(
      rows.map((p) => this.toAdminView(p)),
      total,
      query,
    );
  }

  async create(dto: CreateProviderDto): Promise<AdminProviderDto> {
    if (dto.type !== ProviderType.MOCK && !dto.apiKey) {
      throw this.keyRequired('apiKey is required unless type is MOCK');
    }
    const provider = this.providers.create({
      name: dto.name,
      type: dto.type,
      model: dto.model,
      isEnabled: dto.isEnabled ?? true,
      isDefault: false,
      ...this.keyColumns(dto.apiKey),
    });
    const saved = await this.saveUnique(provider);
    return this.toAdminView(await this.findOrFail(saved.id));
  }

  async update(id: string, dto: UpdateProviderDto): Promise<AdminProviderDto> {
    const provider = await this.findOrFail(id);
    const type = dto.type ?? provider.type;
    const hasKey = Boolean(dto.apiKey) || provider.apiKeyLast4 !== null;
    const enabled = dto.isEnabled ?? provider.isEnabled;

    if (provider.isDefault && dto.isEnabled === false) {
      throw this.isDefault('The default provider cannot be disabled');
    }
    if (type !== ProviderType.MOCK && !hasKey && (dto.type || enabled)) {
      throw this.keyRequired('apiKey is required unless type is MOCK');
    }

    Object.assign(provider, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.model !== undefined ? { model: dto.model } : {}),
      ...(dto.isEnabled !== undefined ? { isEnabled: dto.isEnabled } : {}),
      ...(dto.apiKey ? this.keyColumns(dto.apiKey) : {}),
      // a new type or key makes the old health result meaningless
      ...(dto.type || dto.apiKey || dto.model
        ? { healthStatus: HealthStatus.UNKNOWN, healthCheckedAt: null }
        : {}),
    });
    await this.saveUnique(provider);
    return this.toAdminView(await this.findOrFail(id));
  }

  /** History keeps working: FKs are ON DELETE SET NULL (PRD PR-3). */
  async remove(id: string): Promise<void> {
    const provider = await this.findOrFail(id);
    if (provider.isDefault) {
      throw this.isDefault('The default provider cannot be deleted');
    }
    await this.providers.delete({ id });
  }

  async setEnabled(id: string, isEnabled: boolean): Promise<AdminProviderDto> {
    const provider = await this.findOrFail(id);
    if (provider.isDefault && !isEnabled) {
      throw this.isDefault('The default provider cannot be disabled');
    }
    if (
      isEnabled &&
      provider.type !== ProviderType.MOCK &&
      !provider.apiKeyLast4
    ) {
      throw this.keyRequired('Add an apiKey before enabling this provider');
    }
    await this.providers.update({ id }, { isEnabled });
    return this.toAdminView(await this.findOrFail(id));
  }

  /** Switches the default in one transaction; the new one must be enabled (PRD PR-6). */
  async setDefault(id: string): Promise<AdminProviderDto> {
    const provider = await this.findOrFail(id);
    if (!provider.isEnabled) {
      throw this.disabled(
        `Provider "${provider.name}" is disabled; enable it first`,
      );
    }
    if (!provider.isDefault) {
      await this.dataSource.transaction(async (m) => {
        await m.update(AiProvider, { isDefault: true }, { isDefault: false });
        await m.update(AiProvider, { id }, { isDefault: true });
      });
    }
    return this.toAdminView(await this.findOrFail(id));
  }

  /** Tiny real call; saves UP/DOWN + time and logs it (PRD PR-7). */
  async healthCheck(id: string): Promise<HealthCheckResultDto> {
    const provider = await this.findWithKeyOrFail(id);
    const result = await this.check(provider);
    RequestContext.setAiCall({
      feature: UsageFeature.HEALTH_CHECK,
      providerId: provider.id,
      success: result.status === HealthStatus.UP,
    });
    return result;
  }

  /** Checks every enabled provider in parallel; one log row per AI call. */
  async healthCheckAll(userId: string): Promise<HealthCheckResultDto[]> {
    const enabled = await this.providers
      .createQueryBuilder('p')
      .addSelect('p.apiKeyEncrypted')
      .where('p.is_enabled')
      .orderBy('p.is_default', 'DESC')
      .addOrderBy('p.name', 'ASC')
      .getMany();
    const results = await Promise.all(enabled.map((p) => this.check(p)));
    for (const result of results) {
      this.usageLogs.recordAiCall({
        userId,
        feature: UsageFeature.HEALTH_CHECK,
        providerId: result.providerId,
        success: result.status === HealthStatus.UP,
        durationMs: result.latencyMs,
      });
    }
    return results;
  }

  /** Saved health of every provider (no live calls), for admin views. */
  async listHealth() {
    const rows = await this.providers.find({
      order: { isDefault: 'DESC', name: 'ASC' },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      isEnabled: p.isEnabled,
      isDefault: p.isDefault,
      healthStatus: p.healthStatus,
      healthCheckedAt: p.healthCheckedAt,
    }));
  }

  private async check(provider: AiProvider): Promise<HealthCheckResultDto> {
    const health = await this.adapterFor(provider).healthCheck();
    const status = health.ok ? HealthStatus.UP : HealthStatus.DOWN;
    const checkedAt = new Date();
    await this.providers.update(
      { id: provider.id },
      { healthStatus: status, healthCheckedAt: checkedAt },
    );
    return {
      providerId: provider.id,
      name: provider.name,
      type: provider.type,
      status,
      latencyMs: health.latencyMs,
      checkedAt,
      error: health.ok ? null : (health.error ?? 'unknown error'),
    };
  }

  private adapterFor(provider: AiProvider): AiProviderAdapter {
    const apiKey = provider.apiKeyEncrypted
      ? decrypt(provider.apiKeyEncrypted, this.encryptionKey)
      : null;
    return this.factory.create(provider, apiKey);
  }

  private keyColumns(apiKey: string | undefined) {
    return apiKey
      ? {
          apiKeyEncrypted: encrypt(apiKey, this.encryptionKey),
          apiKeyLast4: lastFour(apiKey),
        }
      : { apiKeyEncrypted: null, apiKeyLast4: null };
  }

  private async saveUnique(provider: AiProvider): Promise<AiProvider> {
    try {
      return await this.providers.save(provider);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === PG_UNIQUE_VIOLATION
      ) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.PROVIDER_NAME_TAKEN,
          `A provider named "${provider.name}" already exists`,
        );
      }
      throw error;
    }
  }

  private async findOrFail(id: string): Promise<AiProvider> {
    const provider = await this.providers.findOne({ where: { id } });
    if (!provider) {
      throw AppException.notFound('Provider');
    }
    return provider;
  }

  private async findWithKeyOrFail(id: string): Promise<AiProvider> {
    const provider = await this.providers
      .createQueryBuilder('p')
      .addSelect('p.apiKeyEncrypted')
      .where('p.id = :id', { id })
      .getOne();
    if (!provider) {
      throw AppException.notFound('Provider');
    }
    return provider;
  }

  private toAdminView(p: AiProvider): AdminProviderDto {
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      model: p.model,
      isDefault: p.isDefault,
      isEnabled: p.isEnabled,
      hasApiKey: p.apiKeyLast4 !== null,
      apiKeyMasked: maskKey(p.apiKeyLast4),
      healthStatus: p.healthStatus,
      healthCheckedAt: p.healthCheckedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  private disabled(message: string): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.PROVIDER_DISABLED,
      message,
    );
  }

  private isDefault(message: string): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.PROVIDER_IS_DEFAULT,
      message,
    );
  }

  private keyRequired(message: string): AppException {
    return new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      message,
      { apiKey: [message] },
    );
  }
}
