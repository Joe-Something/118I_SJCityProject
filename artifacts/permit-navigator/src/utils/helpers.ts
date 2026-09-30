import { Intake, RequirementId, BusinessType, Modification, requirementsConfig } from '../requirements';
import { Department } from '../types';

export function getMatchedRequirements(intake: Intake): RequirementId[] {
  const customText = `${intake.businessOther} ${intake.modificationOther} ${intake.description}`.toLowerCase();
  const hasPredefinedBusiness = intake.businessType !== '' && intake.businessType !== 'other';
  const foodBusinesses: BusinessType[] = ['boba', 'cafe', 'restaurant', 'kitchen'];
  const buildingChanges: Modification[] = ['plumbing', 'walls', 'hvac', 'electrical', 'exterior'];
  
  const matches = (Object.keys(requirementsConfig) as RequirementId[]).filter(reqId => {
    let exactMatch =
      ((reqId === 'business-registration' || reqId === 'zoning-clearance') && hasPredefinedBusiness) ||
      (reqId === 'health-safety' && foodBusinesses.includes(intake.businessType as BusinessType)) ||
      (reqId === 'building-permits' && buildingChanges.some(change => intake.modifications.includes(change))) ||
      (reqId === 'sign-permits' && (intake.modifications.includes('signage') || intake.modifications.includes('exterior')));
    
    let keywordMatch = false;
    if (reqId === 'health-safety') {
      keywordMatch = /\b(food|cook|kitchen|eat|bake|meat|drink|beverage|cafe|restaurant|boba)\b/i.test(customText);
    } else if (reqId === 'building-permits') {
      keywordMatch = /\b(build|construct|wall|walls|plumb|plumbing|pipe|water|electric|electrical|wire|hvac|air|heat|cool|vent)\b/i.test(customText);
    } else if (reqId === 'sign-permits') {
      keywordMatch = /\b(sign|signs|signage|banner|display|exterior|outside|awning)\b/i.test(customText);
    } else if (reqId === 'business-registration' || reqId === 'zoning-clearance') {
      keywordMatch = /\b(open|store|shop|sell|service|office|business|company|location)\b/i.test(customText);
    }

    return exactMatch || keywordMatch;
  });

  const hasSpecifics = matches.some(m => !['business-registration', 'zoning-clearance'].includes(m));
  if (hasSpecifics) {
    if (!matches.includes('business-registration')) matches.push('business-registration');
    if (!matches.includes('zoning-clearance')) matches.push('zoning-clearance');
  }

  return (Object.keys(requirementsConfig) as RequirementId[]).filter(id => matches.includes(id));
}

export function deriveDepartments(intake: Intake, matched: RequirementId[]): Department[] {
  const deps = new Set<Department>(['Planning']); // Every submitted plan must have at least Planning
  
  if (matched.includes('building-permits')) {
    deps.add('Building');
  }
  
  if (
    matched.includes('health-safety') || 
    intake.modifications.includes('electrical') || 
    intake.modifications.includes('exterior')
  ) {
    deps.add('Fire');
  }
  
  const foodBusinesses: BusinessType[] = ['boba', 'cafe', 'restaurant', 'kitchen'];
  const desc = (intake.description || '').toLowerCase();
  const hasFood = intake.businessType && foodBusinesses.includes(intake.businessType as BusinessType);
  const hasEnvKeywords = /\b(plumbing|hvac|water|waste|grease|sewer)\b/i.test(desc) || intake.modifications.includes('plumbing') || intake.modifications.includes('hvac');
  
  if (hasFood || hasEnvKeywords) {
    deps.add('Environmental Services');
  }
  
  return Array.from(deps);
}

export function generateId() {
  return Math.random().toString(36).substring(2, 11);
}

export const emptyIntake: Intake = {
  businessName: '',
  applicantName: '',
  applicantEmail: '',
  applicantPhone: '',
  businessType: '',
  businessOther: '',
  address: '',
  zip: '',
  description: '',
  modifications: [],
  modificationOther: '',
  files: []
};