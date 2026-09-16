import { UserRole } from '@booking/shared';

/**
 * Granular capabilities. Routes are guarded by a capability, never by a role name, so
 * changing who may do what is a data change rather than a code change.
 *
 * A capability answers "may this kind of user do this at all". It does NOT answer "may
 * they do it to THIS record" — ownership is a separate check in the service layer, because
 * a provider holding `appointments.cancel` may still only cancel their own appointments.
 */
export const PERMISSIONS = {
  APPOINTMENTS_READ: 'appointments.read',
  APPOINTMENTS_READ_ALL: 'appointments.read.all',
  APPOINTMENTS_CREATE: 'appointments.create',
  APPOINTMENTS_UPDATE: 'appointments.update',
  APPOINTMENTS_CANCEL: 'appointments.cancel',
  APPOINTMENTS_RESCHEDULE: 'appointments.reschedule',
  APPOINTMENTS_COMPLETE: 'appointments.complete',

  SERVICES_READ: 'services.read',
  SERVICES_CREATE: 'services.create',
  SERVICES_UPDATE: 'services.update',
  SERVICES_DELETE: 'services.delete',

  PROVIDERS_READ: 'providers.read',
  PROVIDERS_CREATE: 'providers.create',
  PROVIDERS_UPDATE: 'providers.update',
  PROVIDERS_DELETE: 'providers.delete',

  CUSTOMERS_READ: 'customers.read',
  CUSTOMERS_UPDATE: 'customers.update',

  AVAILABILITY_READ: 'availability.read',
  AVAILABILITY_MANAGE: 'availability.manage',
  AVAILABILITY_MANAGE_ALL: 'availability.manage.all',

  TIMEOFF_READ: 'timeoff.read',
  TIMEOFF_MANAGE: 'timeoff.manage',

  HOLIDAYS_MANAGE: 'holidays.manage',

  ANALYTICS_READ: 'analytics.read',
  AUDIT_READ: 'audit.read',

  NOTIFICATIONS_READ: 'notifications.read',
  NOTIFICATIONS_MANAGE: 'notifications.manage',

  SETTINGS_MANAGE: 'settings.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'appointments.read': 'View appointments they are party to',
  'appointments.read.all': 'View every appointment in the business',
  'appointments.create': 'Create appointments',
  'appointments.update': 'Edit appointment details and notes',
  'appointments.cancel': 'Cancel appointments',
  'appointments.reschedule': 'Move appointments to a new time',
  'appointments.complete': 'Mark appointments completed or no-show',
  'services.read': 'View the service catalog',
  'services.create': 'Add services',
  'services.update': 'Edit services',
  'services.delete': 'Deactivate services',
  'providers.read': 'View providers',
  'providers.create': 'Add providers',
  'providers.update': 'Edit providers',
  'providers.delete': 'Deactivate providers',
  'customers.read': 'View customer records',
  'customers.update': 'Edit customer records',
  'availability.read': 'View working hours',
  'availability.manage': 'Edit their own working hours',
  'availability.manage.all': 'Edit any provider working hours',
  'timeoff.read': 'View time off',
  'timeoff.manage': 'Create and remove time off',
  'holidays.manage': 'Manage business holidays',
  'analytics.read': 'View reports and analytics',
  'audit.read': 'View the audit log',
  'notifications.read': 'View notification history',
  'notifications.manage': 'Edit notification templates and settings',
  'settings.manage': 'Change business settings',
};

/**
 * Role expansion. A provider can manage their own calendar but not another provider's,
 * which is why `availability.manage.all` and `appointments.read.all` are admin-only —
 * the narrower capability plus an ownership check covers the provider case.
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.ADMIN]: [...ALL_PERMISSIONS],

  [UserRole.PROVIDER]: [
    PERMISSIONS.APPOINTMENTS_READ,
    PERMISSIONS.APPOINTMENTS_CREATE,
    PERMISSIONS.APPOINTMENTS_UPDATE,
    PERMISSIONS.APPOINTMENTS_CANCEL,
    PERMISSIONS.APPOINTMENTS_RESCHEDULE,
    PERMISSIONS.APPOINTMENTS_COMPLETE,
    PERMISSIONS.SERVICES_READ,
    PERMISSIONS.PROVIDERS_READ,
    PERMISSIONS.CUSTOMERS_READ,
    PERMISSIONS.AVAILABILITY_READ,
    PERMISSIONS.AVAILABILITY_MANAGE,
    PERMISSIONS.TIMEOFF_READ,
    PERMISSIONS.TIMEOFF_MANAGE,
    PERMISSIONS.ANALYTICS_READ,
    PERMISSIONS.NOTIFICATIONS_READ,
  ],

  [UserRole.CUSTOMER]: [
    PERMISSIONS.APPOINTMENTS_READ,
    PERMISSIONS.APPOINTMENTS_CREATE,
    PERMISSIONS.APPOINTMENTS_CANCEL,
    PERMISSIONS.APPOINTMENTS_RESCHEDULE,
    PERMISSIONS.SERVICES_READ,
    PERMISSIONS.PROVIDERS_READ,
    PERMISSIONS.AVAILABILITY_READ,
  ],
};
