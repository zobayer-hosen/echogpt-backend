import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { EntityManager, Repository } from 'typeorm';
import { PlanCode } from '../../common/enums/plan-code.enum';
import { ROLE_IDS, RoleName } from '../../common/enums/role-name.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
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

/** Owns `users` and `roles`. */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly subscriptions: SubscriptionsService,
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

  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.findByIdOrFail(userId);
    return this.toProfile(user, await this.subscriptions.getPlan(userId));
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
}
