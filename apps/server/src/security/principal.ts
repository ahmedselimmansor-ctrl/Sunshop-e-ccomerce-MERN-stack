import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  permissionsForRoles,
  type Permission,
  type Role,
} from '@sunshop/shared';

/**
 * The authenticated (or anonymous) caller.
 *
 * Built once per request by the auth middleware and treated as immutable
 * afterwards. Services take a `Principal` rather than a raw user id so that an
 * ownership check can never be skipped by accident: the data-access helpers
 * require one.
 */
export class Principal {
  readonly id: string | null;
  readonly email: string | null;
  readonly roles: Role[];
  readonly permissions: Permission[];
  readonly sessionId: string | null;
  readonly isAuthenticated: boolean;

  private constructor(input: {
    id: string | null;
    email: string | null;
    roles: Role[];
    sessionId: string | null;
  }) {
    this.id = input.id;
    this.email = input.email;
    this.roles = input.roles;
    this.permissions = permissionsForRoles(input.roles);
    this.sessionId = input.sessionId;
    this.isAuthenticated = input.id !== null;
  }

  static anonymous(): Principal {
    return new Principal({ id: null, email: null, roles: [], sessionId: null });
  }

  static forUser(input: {
    id: string;
    email: string;
    roles: Role[];
    sessionId: string;
  }): Principal {
    return new Principal(input);
  }

  /** Internal callers (cron jobs, webhook handlers) act with full rights. */
  static system(): Principal {
    return new Principal({
      id: null,
      email: 'system@sunshop',
      roles: ['super_admin'],
      sessionId: null,
    });
  }

  can(permission: Permission): boolean {
    return hasPermission(this.permissions, permission);
  }

  canAny(permissions: readonly Permission[]): boolean {
    return hasAnyPermission(this.permissions, permissions);
  }

  canAll(permissions: readonly Permission[]): boolean {
    return hasAllPermissions(this.permissions, permissions);
  }

  hasRole(role: Role): boolean {
    return this.roles.includes(role);
  }

  get isStaff(): boolean {
    return this.roles.some((role) => role !== 'customer');
  }

  /** True when `resourceOwnerId` belongs to this principal. */
  owns(resourceOwnerId: string | null | undefined): boolean {
    return Boolean(this.id && resourceOwnerId && String(resourceOwnerId) === this.id);
  }
}
