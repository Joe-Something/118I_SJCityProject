import { ActivePlan } from './types';

export const PLANS_KEY = 'permit-navigator:prototype-plans:v2';
export const PENDING_PERSONA_KEY = 'permit-navigator:pending-persona';

export type StaffDesk = 'Economic Development' | 'Building Code Reviewer' | 'Fire Prevention';
export type Persona =
  | { kind: 'applicant'; key: string }
  | { kind: 'staff'; desk: StaffDesk };

export function personaKey(userId: string) {
  return `permit-navigator:persona:${userId}`;
}

export function applicantId(userId: string, key: string) {
  return `${userId}:${key.trim().toLowerCase()}`;
}

export function readPersona(value: string | null): Persona | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const entry = parsed as Record<string, unknown>;
    if (entry.kind === 'applicant' && typeof entry.key === 'string' && entry.key.trim()) {
      return { kind: 'applicant', key: entry.key.trim().toLowerCase() };
    }
    if (entry.kind === 'staff' && (entry.desk === 'Economic Development' || entry.desk === 'Building Code Reviewer' || entry.desk === 'Fire Prevention')) {
      return { kind: 'staff', desk: entry.desk };
    }
  } catch { /* Invalid local prototype preference; show login again. */ }
  return null;
}

export function readPlans(): ActivePlan[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PLANS_KEY) || '[]');
    return Array.isArray(value) ? value.filter((item): item is ActivePlan =>
      item && typeof item === 'object' && typeof item.id === 'string' && typeof item.userId === 'string' && item.intake && Array.isArray(item.matched)
    ) : [];
  } catch {
    return [];
  }
}