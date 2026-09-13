/**
 * tests/unit/admin-rbac.test.ts
 *
 * Tests para el sistema RBAC del admin console.
 * Cubre requisitos 71-74: auth, RBAC, leads security, analytics PII.
 */
import { describe, it, expect } from 'vitest';
import { hasPermission, isValidAdminRole } from '../../src/lib/rbac';
import type { AdminRole } from '../../src/lib/rbac';

describe('RBAC — Roles y permisos', () => {
  // ── Administrador ────────────────────────────────────────────────────────────
  describe('Administrador', () => {
    const role: AdminRole = 'Administrador';

    it('tiene dashboard.view', () => {
      expect(hasPermission(role, 'dashboard.view')).toBe(true);
    });

    it('tiene leads.view', () => {
      expect(hasPermission(role, 'leads.view')).toBe(true);
    });

    it('tiene leads.detail.view (PII)', () => {
      expect(hasPermission(role, 'leads.detail.view')).toBe(true);
    });

    it('tiene leads.export.sensitive', () => {
      expect(hasPermission(role, 'leads.export.sensitive')).toBe(true);
    });

    it('tiene users.manage equivalentes (invite, role, disable)', () => {
      expect(hasPermission(role, 'users.invite')).toBe(true);
      expect(hasPermission(role, 'users.role.change')).toBe(true);
      expect(hasPermission(role, 'users.disable')).toBe(true);
    });

    it('tiene settings.edit', () => {
      expect(hasPermission(role, 'settings.edit')).toBe(true);
    });

    it('tiene reports.create', () => {
      expect(hasPermission(role, 'reports.create')).toBe(true);
    });

    it('tiene audit.view', () => {
      expect(hasPermission(role, 'audit.view')).toBe(true);
    });
  });

  // ── Editor ───────────────────────────────────────────────────────────────────
  describe('Editor', () => {
    const role: AdminRole = 'Editor';

    it('tiene leads.view', () => {
      expect(hasPermission(role, 'leads.view')).toBe(true);
    });

    it('tiene leads.detail.view (PII)', () => {
      expect(hasPermission(role, 'leads.detail.view')).toBe(true);
    });

    it('tiene leads.status.change', () => {
      expect(hasPermission(role, 'leads.status.change')).toBe(true);
    });

    it('tiene leads.export básico', () => {
      expect(hasPermission(role, 'leads.export')).toBe(true);
    });

    it('NO tiene leads.export.sensitive', () => {
      expect(hasPermission(role, 'leads.export.sensitive')).toBe(false);
    });

    it('NO tiene users.invite', () => {
      expect(hasPermission(role, 'users.invite')).toBe(false);
    });

    it('NO tiene users.role.change', () => {
      expect(hasPermission(role, 'users.role.change')).toBe(false);
    });

    it('NO tiene settings.edit', () => {
      expect(hasPermission(role, 'settings.edit')).toBe(false);
    });

    it('NO tiene audit.view', () => {
      expect(hasPermission(role, 'audit.view')).toBe(false);
    });

    it('NO tiene reports.create', () => {
      expect(hasPermission(role, 'reports.create')).toBe(false);
    });
  });

  // ── Lector ───────────────────────────────────────────────────────────────────
  describe('Lector', () => {
    const role: AdminRole = 'Lector';

    it('tiene dashboard.view', () => {
      expect(hasPermission(role, 'dashboard.view')).toBe(true);
    });

    it('tiene leads.view (lista sin PII)', () => {
      expect(hasPermission(role, 'leads.view')).toBe(true);
    });

    it('NO tiene leads.detail.view (no puede ver PII)', () => {
      expect(hasPermission(role, 'leads.detail.view')).toBe(false);
    });

    it('NO puede exportar', () => {
      expect(hasPermission(role, 'leads.export')).toBe(false);
      expect(hasPermission(role, 'leads.export.sensitive')).toBe(false);
    });

    it('NO puede cambiar estado CRM', () => {
      expect(hasPermission(role, 'leads.status.change')).toBe(false);
    });

    it('NO tiene users.invite', () => {
      expect(hasPermission(role, 'users.invite')).toBe(false);
    });

    it('NO tiene settings.edit', () => {
      expect(hasPermission(role, 'settings.edit')).toBe(false);
    });

    it('NO tiene reports.create', () => {
      expect(hasPermission(role, 'reports.create')).toBe(false);
    });
  });

  // ── Validación de roles ───────────────────────────────────────────────────────
  describe('isValidAdminRole', () => {
    it('acepta roles válidos', () => {
      expect(isValidAdminRole('Administrador')).toBe(true);
      expect(isValidAdminRole('Editor')).toBe(true);
      expect(isValidAdminRole('Lector')).toBe(true);
    });

    it('rechaza rol inventado', () => {
      expect(isValidAdminRole('admin')).toBe(false);
      expect(isValidAdminRole('superuser')).toBe(false);
      expect(isValidAdminRole('')).toBe(false);
      expect(isValidAdminRole(null)).toBe(false);
      expect(isValidAdminRole(undefined)).toBe(false);
    });

    it('role spoofing — "Administrador" en string no coincide con valor no autorizado', () => {
      expect(isValidAdminRole('Administrador ')).toBe(false); // con espacio
      expect(isValidAdminRole('ADMINISTRADOR')).toBe(false);  // mayúsculas
    });
  });

  // ── Sin permiso de rol desconocido ────────────────────────────────────────────
  describe('Rol desconocido', () => {
    it('siempre devuelve false para rol inválido', () => {
      expect(hasPermission('Fantasma' as AdminRole, 'dashboard.view')).toBe(false);
    });
  });
});
