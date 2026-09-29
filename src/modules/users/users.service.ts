import { forwardRef, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { EntityManager, Repository } from 'typeorm';
import { ErrorCode } from '../../common/constants/error-codes';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { Paginated } from '../../common/dto/paginated-response.dto';
import { PlanCode } from '../../common/enums/plan-code.enum';
import { ROLE_IDS, RoleName } from '../../common/enums/role-name.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { AppException } from '../../common/exceptions/app.exception';
import {
  escapeLike,
  pageOffset,
  toPage,
} from '../../common/utils/pagination.util';
import { TokenService } from '../auth/token.service';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  AdminUpdateUserDto,
  AdminUserDto,
  AdminUsersQueryDto,
} from './dto/admin-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { User } from './entities/user.entity';

/** bcrypt cost (PRD AU-6). */
export const BCRYPT_ROUNDS = 10;

export interface NewUser {
  email: string;
  password: string;
  fullName: string;
  role?: RoleName;
}

const invalidPassword = () =>
  new AppException(
    HttpStatus.UNAUTHORIZED,
    ErrorCode.INVALID_CREDENTIALS,
    'Current password is incorrect',
  );

/** Owns `users` and `roles`. */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly subscriptions: SubscriptionsService,
    @Inject(forwardRef(() => TokenService))
    private readonly tokens: TokenService,
  ) {}

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /** True if a non-deleted user has this (lowercased) email. */
  emailTaken(email: string): Promise<boolean> {
    return this.users.exists({ where: { email } });
  }

  /** Inserts a user inside the caller's transaction. */
  async create(manager: EntityManager, data: NewUser): Promise<User> {
    const user = manager.create(User, {
      email: data.email,
      passwordHash: await this.hashPassword(data.password),
      fullName: data.fullName,
      roleId: ROLE_IDS[data.role ?? RoleName.USER],
    });
    return manager.save(user);
  }

  /** Loads a non-deleted user with role and password hash, for login. */
  findForLogin(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .innerJoinAndSelect('u.role', 'r')
      .where('u.email = :email', { email })
      .getOne();
  }

  async markLoggedIn(userId: string): Promise<void> {
    await this.users.update({ id: userId }, { lastLoginAt: new Date() });
  }

  async findByIdOrFail(userId: string): Promise<User> {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { role: true },
    });
    if (!user) {
      throw AppException.notFound('User');
    }
    return user;
  }

  // ---- self-service (/users/me) ----

  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.findByIdOrFail(userId);
    return this.toProfile(user, await this.subscriptions.getPlan(userId));
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<UserProfileDto> {
    if (dto.fullName === undefined && dto.avatarUrl === undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Nothing to update: send fullName and/or avatarUrl',
      );
    }
    await this.users.update(
      { id: userId },
      {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
      },
    );
    return this.getProfile(userId);
  }

  /** Needs the current password; logs out every other device (PRD US-3). */
  async changePassword(user: AuthUser, dto: ChangePasswordDto): Promise<void> {
    const hash = await this.passwordHashOf(user.id);
    if (!(await this.verifyPassword(dto.currentPassword, hash))) {
      throw invalidPassword();
    }
    if (await this.verifyPassword(dto.newPassword, hash)) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'New password must be different from the current one',
        { newPassword: ['must differ from currentPassword'] },
      );
    }
    await this.users.update(
      { id: user.id },
      { passwordHash: await this.hashPassword(dto.newPassword) },
    );
    await this.tokens.revokeAllForUser(user.id, user.sessionId);
  }

  /** Soft delete; frees the email and revokes all sessions (PRD US-4, A6). */
  async deleteOwnAccount(user: AuthUser, password: string): Promise<void> {
    const hash = await this.passwordHashOf(user.id);
    if (!(await this.verifyPassword(password, hash))) {
      throw invalidPassword();
    }
    await this.softDelete(await this.findByIdOrFail(user.id));
  }

  // ---- admin (/admin/users) ----

  async list(query: AdminUsersQueryDto): Promise<Paginated<AdminUserDto>> {
    const qb = this.users
      .createQueryBuilder('u')
      .innerJoinAndSelect('u.role', 'r')
      .innerJoin(Subscription, 's', 's.user_id = u.id')
      .addSelect('s.plan', 'plan');

    if (query.search) {
      qb.andWhere('(u.email ILIKE :search OR u.full_name ILIKE :search)', {
        search: `%${escapeLike(query.search)}%`,
      });
    }
    if (query.role) {
      qb.andWhere('r.name = :role', { role: query.role });
    }
    if (query.status) {
      qb.andWhere('u.status = :status', { status: query.status });
    }
    if (query.plan) {
      qb.andWhere('s.plan = :plan', { plan: query.plan });
    }

    const total = await qb.getCount();
    const { entities, raw } = await qb
      .orderBy('u.created_at', 'DESC')
      .addOrderBy('u.id', 'ASC')
      .offset(pageOffset(query))
      .limit(query.limit)
      .getRawAndEntities<{ u_id: string; plan: PlanCode }>();

    const planById = new Map(raw.map((row) => [row.u_id, row.plan]));
    return toPage(
      entities.map((u) => this.toAdminView(u, planById.get(u.id)!)),
      total,
      query,
    );
  }

  async getForAdmin(userId: string): Promise<AdminUserDto> {
    const user = await this.findByIdOrFail(userId);
    return this.toAdminView(user, await this.subscriptions.getPlan(userId));
  }

  /** Change role and/or status. Suspending revokes all sessions (PRD AD-2). */
  async updateByAdmin(
    userId: string,
    dto: AdminUpdateUserDto,
  ): Promise<AdminUserDto> {
    if (dto.role === undefined && dto.status === undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Nothing to update: send role and/or status',
      );
    }
    const user = await this.findByIdOrFail(userId);
    const losesAdmin =
      user.role.name === RoleName.ADMIN &&
      user.status === UserStatus.ACTIVE &&
      ((dto.role !== undefined && dto.role !== RoleName.ADMIN) ||
        dto.status === UserStatus.SUSPENDED);
    if (losesAdmin) {
      await this.assertNotLastAdmin();
    }

    await this.users.update(
      { id: userId },
      {
        ...(dto.role ? { roleId: ROLE_IDS[dto.role] } : {}),
        ...(dto.status ? { status: dto.status } : {}),
      },
    );
    if (dto.status === UserStatus.SUSPENDED) {
      await this.tokens.revokeAllForUser(userId);
    }
    return this.getForAdmin(userId);
  }

  async deleteByAdmin(userId: string): Promise<void> {
    await this.softDelete(await this.findByIdOrFail(userId));
  }

  // ---- admin dashboard ----

  async countStats(): Promise<{ total: number; newLast7Days: number }> {
    const [row] = await this.users.query<
      { total: number; new_last_7_days: number }[]
    >(
      `SELECT count(*)::int AS total,
              (count(*) FILTER (WHERE created_at >= now() - interval '7 days'))::int AS new_last_7_days
         FROM users
        WHERE deleted_at IS NULL`,
    );
    return { total: row.total, newLast7Days: row.new_last_7_days };
  }

  toProfile(user: User, plan: PlanCode): UserProfileDto {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      role: user.role.name,
      isEmailVerified: user.isEmailVerified,
      plan,
      createdAt: user.createdAt,
    };
  }

  private toAdminView(user: User, plan: PlanCode): AdminUserDto {
    return {
      ...this.toProfile(user, plan),
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      updatedAt: user.updatedAt,
    };
  }

  private async softDelete(user: User): Promise<void> {
    if (
      user.role.name === RoleName.ADMIN &&
      user.status === UserStatus.ACTIVE
    ) {
      await this.assertNotLastAdmin();
    }
    await this.users.softDelete({ id: user.id });
    await this.tokens.revokeAllForUser(user.id);
  }

  /** The system must always keep one active admin (PRD US-4). */
  private async assertNotLastAdmin(): Promise<void> {
    const activeAdmins = await this.users.count({
      where: { roleId: ROLE_IDS[RoleName.ADMIN], status: UserStatus.ACTIVE },
    });
    if (activeAdmins <= 1) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.LAST_ADMIN,
        'The last active admin cannot be removed, demoted or suspended',
      );
    }
  }

  private async passwordHashOf(userId: string): Promise<string> {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.id = :id', { id: userId })
      .getOne();
    if (!user) {
      throw AppException.notFound('User');
    }
    return user.passwordHash;
  }
}
