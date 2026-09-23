import { Intake, RequirementId } from './requirements';
import { Language } from './copy';

export type PlanStatus = 'Draft' | 'Draft — Requires Review' | 'In Review (Re-opened)' | 'Approved' | 'Rejected' | 'Modified via Staff Override';

export type ActivePlan = {
  id: string;
  userId: string;
  reviewer?: string;
  intake: Intake;
  language: Language;
  customLanguage: string;
  simplified: boolean;
  createdAt: number;
  updatedAt: number;
  submittedAt?: number;
  completedAt?: number;
  status: PlanStatus;
  notes: Record<string, string>;
  overrides: Record<string, string>;
  rejected: RequirementId[];
  matched: RequirementId[];
};