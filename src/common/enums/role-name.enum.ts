export enum RoleName {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

/** Fixed ids of the seeded `roles` rows. */
export const ROLE_IDS: Record<RoleName, number> = {
  [RoleName.ADMIN]: 1,
  [RoleName.USER]: 2,
};
