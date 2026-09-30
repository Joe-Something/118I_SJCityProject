export type BusinessType = 'boba' | 'restaurant' | 'retail' | 'kitchen' | 'cafe' | 'salon' | 'office' | 'service' | 'other';
export type Modification = 'plumbing' | 'walls' | 'signage' | 'hvac' | 'electrical' | 'exterior' | 'other';

export const PROTOTYPE_REQUIREMENT_VERSION = 'sample-1';
export const PROTOTYPE_REQUIREMENT_REVISED = '2026-09-29';

export type RequirementId = 'business-registration' | 'zoning-clearance' | 'building-permits' | 'sign-permits' | 'health-safety';

export type Intake = {
  businessName: string;
  applicantName?: string;
  applicantEmail?: string;
  applicantPhone?: string;
  businessType: BusinessType | '';
  businessOther: string;
  address: string;
  zip: string;
  description: string;
  modifications: Modification[];
  modificationOther: string;
  files: File[];
};

export type RequirementConfig = {
  id: RequirementId;
  applies_to: BusinessType[];
  modifications?: Modification[];
  source_url: string;
};

export const requirementsConfig: Record<RequirementId, RequirementConfig> = {
  'business-registration': {
    id: 'business-registration',
    applies_to: ['boba', 'restaurant', 'retail', 'kitchen', 'cafe', 'salon', 'office', 'service'],
    source_url: 'https://www.sanjoseca.gov/your-government/departments-offices/finance/business-tax-registration'
  },
  'zoning-clearance': {
    id: 'zoning-clearance',
    applies_to: ['boba', 'restaurant', 'retail', 'kitchen', 'cafe', 'salon', 'office', 'service'],
    source_url: 'https://www.sanjoseca.gov/business/development-services-permit-center/online-permits-at-sjpermits-org/planning-online-permits'
  },
  'building-permits': {
    id: 'building-permits',
    applies_to: ['boba', 'restaurant', 'kitchen', 'cafe', 'salon', 'retail', 'office', 'service'],
    modifications: ['plumbing', 'walls', 'hvac', 'electrical', 'exterior'],
    source_url: 'https://www.sanjoseca.gov/business/development-services-permit-center/building-permit-services-appointments'
  },
  'sign-permits': {
    id: 'sign-permits',
    applies_to: ['boba', 'restaurant', 'retail', 'kitchen', 'cafe', 'salon', 'office', 'service'],
    modifications: ['signage', 'exterior'],
    source_url: 'https://www.sanjoseca.gov/business/development-services-permit-center/online-permits-at-sjpermits-org/planning-online-permits'
  },
  'health-safety': {
    id: 'health-safety',
    applies_to: ['boba', 'restaurant', 'kitchen', 'cafe'],
    modifications: ['plumbing', 'hvac'],
    source_url: 'https://www.sanjoseca.gov/business/development-services-permit-center/fire-permits-and-hazmat'
  }
};
