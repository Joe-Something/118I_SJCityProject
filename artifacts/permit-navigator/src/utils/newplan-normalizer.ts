import type { ApplicationRecord } from '@workspace/api-client-react';
import type { ActivePlan, Department } from '../types';
import type { BusinessType, Intake, Modification, RequirementId } from '../requirements';

export type NormalizedApplicationPlan = {
  plan: ActivePlan;
  detailIssue: string | null;
};

const businessTypes = new Set<BusinessType>([
  'boba', 'restaurant', 'retail', 'kitchen', 'cafe', 'salon', 'office', 'service', 'other',
]);
const departments = new Set<Department>(['Building', 'Fire', 'Environmental Services', 'Planning']);
const planDetailIssues = new WeakMap<ActivePlan, string>();

export function getApplicationPlanDetailIssue(plan: ActivePlan): string | null {
  return planDetailIssues.get(plan) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function timestamp(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : undefined;
}

/** Normalize old, incomplete JSON for safe UI reads without modifying the API record. */
export function normalizeApplicationPlan(
  value: unknown,
  record: Pick<ApplicationRecord, 'id' | 'businessName' | 'status' | 'createdAt' | 'updatedAt' | 'submittedAt'>,
): NormalizedApplicationPlan {
  const raw = isRecord(value) ? value : {};
  const rawIntake = isRecord(raw.intake) ? raw.intake : {};
  const address = typeof rawIntake.address === 'string' ? rawIntake.address : '';
  const businessType = typeof rawIntake.businessType === 'string' && businessTypes.has(rawIntake.businessType as BusinessType)
    ? rawIntake.businessType as Intake['businessType']
    : '';
  const description = typeof rawIntake.description === 'string' ? rawIntake.description : '';
  const businessOther = typeof rawIntake.businessOther === 'string' ? rawIntake.businessOther : '';
  const intakeIsUsable = isRecord(value)
    && isRecord(value.intake)
    && Boolean(address.trim())
    && businessType !== ''
    && Boolean(description.trim())
    && (businessType !== 'other' || Boolean(businessOther.trim()));

  const intake = {
    ...rawIntake,
    businessName: typeof rawIntake.businessName === 'string' ? rawIntake.businessName : record.businessName,
    applicantName: typeof rawIntake.applicantName === 'string' ? rawIntake.applicantName : undefined,
    applicantEmail: typeof rawIntake.applicantEmail === 'string' ? rawIntake.applicantEmail : undefined,
    applicantPhone: typeof rawIntake.applicantPhone === 'string' ? rawIntake.applicantPhone : undefined,
    businessType,
    businessOther,
    address,
    zip: typeof rawIntake.zip === 'string' ? rawIntake.zip : '',
    description,
    modifications: stringArray(rawIntake.modifications) as Modification[],
    modificationOther: typeof rawIntake.modificationOther === 'string' ? rawIntake.modificationOther : '',
    files: [],
  } as Intake;
  const matched = stringArray(raw.matched) as RequirementId[];
  const rejected = stringArray(raw.rejected) as RequirementId[];
  const language = ['en', 'es', 'vi', 'zh', 'tl', 'other'].includes(String(raw.language))
    ? raw.language as ActivePlan['language']
    : 'en';
  const plan = {
    ...raw,
    id: record.id,
    userId: typeof raw.userId === 'string' ? raw.userId : '',
    intake,
    language,
    customLanguage: typeof raw.customLanguage === 'string' ? raw.customLanguage : '',
    simplified: typeof raw.simplified === 'boolean' ? raw.simplified : false,
    createdAt: timestamp(record.createdAt) ?? 0,
    updatedAt: timestamp(record.updatedAt) ?? 0,
    submittedAt: timestamp(record.submittedAt),
    completedAt: typeof raw.completedAt === 'number' && Number.isFinite(raw.completedAt) ? raw.completedAt : undefined,
    status: record.status as ActivePlan['status'],
    departments: Array.isArray(raw.departments)
      ? raw.departments.filter((department): department is Department => typeof department === 'string' && departments.has(department as Department))
      : undefined,
    departmentAssignees: isRecord(raw.departmentAssignees) ? raw.departmentAssignees : undefined,
    notes: stringMap(raw.notes),
    overrides: stringMap(raw.overrides),
    rejected,
    matched,
  } as ActivePlan;

  const detailIssue = intakeIsUsable
    ? null
    : 'Application details are incomplete. The saved record is unchanged, but its full details cannot be shown or reopened.';
  if (detailIssue) planDetailIssues.set(plan, detailIssue);
  return { plan, detailIssue };
}