import {
  ROLE_PERMISSIONS,
  canAssignRole,
  canManageUser,
  hasPermission,
  permissionsForRoles,
} from '@sunshop/shared';
import { describe, expect, it } from 'vitest';

describe('rbac', () => {
  it('gives anonymous callers read-only catalogue access', () => {
    const permissions = permissionsForRoles([]);
    expect(permissions).toContain('product:read');
    expect(permissions).not.toContain('product:write');
    expect(permissions).not.toContain('order:read:any');
  });

  it('never grants a customer cross-tenant order access', () => {
    const permissions = ROLE_PERMISSIONS.customer;
    expect(permissions).toContain('order:read:own');
    expect(permissions).not.toContain('order:read:any');
  });

  it('unions permissions across multiple roles', () => {
    const permissions = permissionsForRoles(['support', 'catalog_manager']);
    expect(hasPermission(permissions, 'order:read:any')).toBe(true);
    expect(hasPermission(permissions, 'product:write')).toBe(true);
  });

  describe('privilege escalation guards', () => {
    it('stops an admin minting another admin', () => {
      // The classic horizontal-escalation hole: equal rank must not be enough.
      expect(canAssignRole(['admin'], 'admin')).toBe(false);
      expect(canAssignRole(['admin'], 'super_admin')).toBe(false);
    });

    it('lets an admin assign strictly lower roles', () => {
      expect(canAssignRole(['admin'], 'support')).toBe(true);
      expect(canAssignRole(['admin'], 'customer')).toBe(true);
    });

    it('lets a super_admin assign anything', () => {
      expect(canAssignRole(['super_admin'], 'admin')).toBe(true);
      expect(canAssignRole(['super_admin'], 'super_admin')).toBe(true);
    });

    it('stops support from managing an admin', () => {
      expect(canManageUser(['support'], ['admin'])).toBe(false);
      expect(canManageUser(['support'], ['customer'])).toBe(true);
    });

    it('stops a customer managing anyone', () => {
      expect(canManageUser(['customer'], ['customer'])).toBe(false);
    });
  });
});
