export const roles = ['owner', 'admin', 'cashier', 'stock'] as const;
export type Role = (typeof roles)[number];
export const permissions = {
  owner: [
    'sell',
    'discount',
    'refund',
    'products',
    'inventory',
    'purchases',
    'suppliers',
    'customers',
    'reports',
    'cash',
    'settings',
    'users',
    'audit',
  ],
  admin: [
    'sell',
    'discount',
    'refund',
    'products',
    'inventory',
    'purchases',
    'suppliers',
    'customers',
    'reports',
    'cash',
    'audit',
  ],
  cashier: ['sell', 'customers', 'cash'],
  stock: ['products', 'inventory', 'purchases', 'suppliers'],
} satisfies Record<Role, string[]>;
export type Permission = (typeof permissions.owner)[number];
export function can(role: Role, permission: Permission): boolean {
  return (permissions[role] as readonly string[]).includes(permission);
}
