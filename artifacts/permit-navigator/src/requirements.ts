export type BusinessType = 'boba' | 'restaurant' | 'retail' | 'kitchen' | 'other';
export type Modification = 'plumbing' | 'walls' | 'signage' | 'hvac';

export type Requirement = {
  id: string;
  requirement_name: string;
  description: string;
  applies_to: BusinessType[];
  modifications?: Modification[];
  required_documents: string[];
  suggested_next_steps: string[];
  city_department: string;
  source_title: string;
  source_url: string;
  simplified_description: string;
};

export const DISCLAIMER = 'Prototype Sample Data — Not official city advice.';

export const requirements: Requirement[] = [
  {
    id: 'business-registration',
    requirement_name: 'Business Registration',
    description: 'Most new businesses start by registering the business name and structure before opening.',
    applies_to: ['boba', 'restaurant', 'retail', 'kitchen'],
    required_documents: ['Business name and ownership details', 'State registration confirmation, if applicable'],
    suggested_next_steps: ['Confirm your business structure', 'Check the City Business Tax Certificate process'],
    city_department: 'Finance Department',
    source_title: 'Business Tax & Registration overview',
    source_url: 'https://www.sanjoseca.gov/',
    simplified_description: 'Register your business and check the City tax certificate step.',
  },
  {
    id: 'zoning-clearance',
    requirement_name: 'Zoning Clearance',
    description: 'The proposed location should be checked against local zoning before you sign a long-term lease or begin work.',
    applies_to: ['boba', 'restaurant', 'retail', 'kitchen'],
    required_documents: ['Site address or parcel information', 'Proposed use and hours'],
    suggested_next_steps: ['Ask Planning about the proposed use', 'Keep written confirmation with your project records'],
    city_department: 'Planning Division',
    source_title: 'Planning and zoning information',
    source_url: 'https://www.sanjoseca.gov/planning',
    simplified_description: 'Ask Planning if this location allows your type of business.',
  },
  {
    id: 'building-permits',
    requirement_name: 'Building Permits',
    description: 'Construction or alterations such as plumbing, walls, or mechanical systems may need review before work begins.',
    applies_to: ['boba', 'restaurant', 'kitchen'],
    modifications: ['plumbing', 'walls', 'hvac'],
    required_documents: ['Scope of work', 'Plans or drawings prepared for review', 'Contractor information, if applicable'],
    suggested_next_steps: ['Describe each proposed alteration', 'Ask Building Division which plan set is needed'],
    city_department: 'Building Division',
    source_title: 'Building permits and plan review',
    source_url: 'https://www.sanjoseca.gov/building',
    simplified_description: 'Construction, plumbing, walls, and mechanical work may need plans and permits.',
  },
  {
    id: 'sign-permits',
    requirement_name: 'Sign Permits',
    description: 'A new exterior sign, sign face, or illuminated sign may need a separate review based on its location and design.',
    applies_to: ['boba', 'restaurant', 'retail', 'kitchen'],
    modifications: ['signage'],
    required_documents: ['Sign dimensions and materials', 'Building elevation or storefront photo', 'Lighting details, if applicable'],
    suggested_next_steps: ['Sketch the sign location and size', 'Ask Planning about design and placement review'],
    city_department: 'Planning Division',
    source_title: 'Signs and storefront guidance',
    source_url: 'https://www.sanjoseca.gov/planning',
    simplified_description: 'A storefront sign may need its own review. Prepare its size and location.',
  },
  {
    id: 'health-safety',
    requirement_name: 'Health or Safety Permits',
    description: 'Food service and commercial kitchen operations often involve health, fire, or safety review by the appropriate agency.',
    applies_to: ['boba', 'restaurant', 'kitchen'],
    modifications: ['plumbing', 'hvac'],
    required_documents: ['Menu or process description', 'Equipment list', 'Floor plan showing food preparation areas'],
    suggested_next_steps: ['Describe food preparation and equipment', 'Contact the County environmental health office and Fire Prevention for direction'],
    city_department: 'Environmental Health / Fire Prevention',
    source_title: 'Food facility and fire safety starting points',
    source_url: 'https://www.sanjoseca.gov/fire',
    simplified_description: 'Food preparation and kitchen equipment may need health and fire safety review.',
  },
];

export const businessLabels: Record<BusinessType, string> = {
  boba: 'Boba Shop / Cafe',
  restaurant: 'Full-Service Restaurant',
  retail: 'Retail',
  kitchen: 'Commercial Kitchen',
  other: 'Something else / not listed',
};

export const modificationLabels: Record<Modification, string> = {
  plumbing: 'Plumbing / sink',
  walls: 'Structural wall removal',
  signage: 'New signage',
  hvac: 'HVAC / hood',
};