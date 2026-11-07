// Domain types for INFINITY SERVICES – Queue Management System.
// These are shared across the frontend now and the Node/SQLite backend later.

export type StaffRole = 'admin' | 'senior_clerk' | 'service_officer' | 'receptionist';

export const STAFF_ROLES: { id: StaffRole; label: string; description: string }[] = [
  { id: 'admin', label: 'Administrator', description: 'Full system control, settings, staff, and backups.' },
  { id: 'senior_clerk', label: 'Senior Clerk', description: 'Supervises counters, manages queue flow and escalations.' },
  { id: 'service_officer', label: 'Service Officer', description: 'Operates a service counter and calls next ticket.' },
  { id: 'receptionist', label: 'Receptionist', description: 'Generates tickets and assigns services to visitors.' },
];

export const ROLE_PERMISSIONS: Record<StaffRole, ModuleId[]> = {
  admin: ['dashboard', 'services', 'counters', 'staff', 'queue-settings', 'reception', 'counter-desk', 'tv-display', 'reports', 'system-settings'],
  senior_clerk: ['dashboard', 'counters', 'queue-settings', 'counter-desk', 'reports'],
  service_officer: ['counter-desk'],
  receptionist: ['reception'],
};

export type ModuleId =
  | 'dashboard'
  | 'services'
  | 'counters'
  | 'staff'
  | 'queue-settings'
  | 'reception'
  | 'counter-desk'
  | 'tv-display'
  | 'reports'
  | 'system-settings';

export interface AppModule {
  id: ModuleId;
  label: string;
  short: string;
  description: string;
  roles: StaffRole[];
}

export const MODULES: AppModule[] = [
  { id: 'dashboard', label: 'Admin Dashboard', short: 'Dashboard', description: 'Live overview of counters, waiting tickets, and average wait times.', roles: ['admin', 'senior_clerk'] },
  { id: 'services', label: 'Services Management', short: 'Services', description: 'Create and edit the service categories offered to visitors.', roles: ['admin'] },
  { id: 'counters', label: 'Counters Management', short: 'Counters', description: 'Configure 20+ service counters, assign staff and services.', roles: ['admin', 'senior_clerk'] },
  { id: 'staff', label: 'Staff Management', short: 'Staff', description: 'Add staff accounts, assign roles and permission levels.', roles: ['admin'] },
  { id: 'queue-settings', label: 'Queue Settings', short: 'Queue Rules', description: 'Configure priority rules, prefixes, and ticket numbering.', roles: ['admin', 'senior_clerk'] },
  { id: 'reception', label: 'Reception & Tickets', short: 'Reception', description: 'Generate tickets and print visitor queue numbers.', roles: ['receptionist'] },
  { id: 'counter-desk', label: 'Counter Desk', short: 'Counter', description: 'Call next, recall, transfer, and complete tickets.', roles: ['service_officer', 'senior_clerk'] },
  { id: 'tv-display', label: 'Public TV Display', short: 'TV Display', description: 'Now-serving board with MP4 advertisement rotation.', roles: ['admin', 'service_officer', 'receptionist', 'senior_clerk'] },
  { id: 'reports', label: 'Reports & Analytics', short: 'Reports', description: 'Turnaround time, service volume, and counter performance.', roles: ['admin', 'senior_clerk'] },
  { id: 'system-settings', label: 'System Settings', short: 'Settings', description: 'LAN binding, backup, restore, and advertisement uploads.', roles: ['admin'] },
];

export type TicketStatus = 'waiting' | 'called' | 'serving' | 'completed' | 'no_show' | 'transferred';
export type PriorityLevel = 'normal' | 'priority' | 'vip';
