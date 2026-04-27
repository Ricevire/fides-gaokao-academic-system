export type ViewKey = 'dashboard' | 'students' | 'teachers' | 'classes' | 'combos' | 'timetable' | 'exams' | 'audit';
export type SortOrder = 'asc' | 'desc';

export interface NavItem {
  view: ViewKey;
  label: string;
  permission: string;
}

export interface SessionUser {
  id?: number;
  username: string;
  displayName?: string;
  role?: string;
  tenantId?: number;
  tenantName?: string;
  campusId?: number | null;
  campusName?: string | null;
  academicYearId?: number | null;
  academicYearName?: string | null;
  permissions?: string[];
  pages?: Array<{ view: string; label?: string }>;
  mustChangePassword?: boolean;
}

export interface ListState {
  page: number;
  pageSize: number;
  sort: string;
  order: SortOrder | string;
  q?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface PagedResponse<T = unknown> {
  items?: T[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasPrev: boolean;
    hasNext: boolean;
  };
  sort?: {
    key: string;
    order: SortOrder;
  };
}

export interface AppState {
  token: string | null;
  user: SessionUser | null;
  view: ViewKey;
  meta: any;
  lists: Record<string, ListState>;
}
