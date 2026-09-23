import { Intake, Modification, BusinessType } from '../requirements';
import { copy } from '../copy';

export const STAFF_REVIEWERS = ['Alice Chen (Planning)', 'Marcus Johnson (Building)', 'Sarah Smith (Fire/Safety)'];

const SAN_JOSE_ADDRESSES = [
  '123 E Santa Clara St', '456 S 1st St', '789 W San Carlos St', 
  '101 N 4th St', '202 The Alameda', '303 Blossom Hill Rd', 
  '404 Stevens Creek Blvd', '505 Winchester Blvd', '111 W Saint John St',
  '890 De Anza Blvd', '777 Story Rd', '555 Capitol Expy'
];

export function generateRandomActionPlan(queueLength: number) {
  const types = [
    { type: 'boba' as BusinessType, other: '' },
    { type: 'cafe' as BusinessType, other: '' },
    { type: 'other' as BusinessType, other: 'Commercial Bakery' },
    { type: 'other' as BusinessType, other: 'Fitness Studio' },
    { type: 'other' as BusinessType, other: 'Auto Repair' }
  ];
  
  const randomValues = new Uint32Array(4);
  window.crypto.getRandomValues(randomValues);
  
  const selectedType = types[randomValues[0] % types.length];
  const address = SAN_JOSE_ADDRESSES[randomValues[1] % SAN_JOSE_ADDRESSES.length];
  const sqft = (randomValues[2] % (5000 - 700 + 1)) + 700;
  
  const allMods: Modification[] = ['plumbing', 'walls', 'signage', 'hvac', 'electrical', 'exterior'];
  const numMods = (randomValues[3] % 3) + 1; // 1 to 3 mods
  const shuffledMods = [...allMods].sort(() => 0.5 - Math.random());
  const selectedMods = shuffledMods.slice(0, numMods);

  const intake: Intake = {
    businessType: selectedType.type,
    businessOther: selectedType.other,
    address,
    zip: '95112',
    description: `Opening a new ${selectedType.other || copy.en.businessLabels[selectedType.type]} in a ${sqft} sq ft space.`,
    modifications: selectedMods,
    modificationOther: '',
    files: []
  };

  const reviewer = STAFF_REVIEWERS[queueLength % STAFF_REVIEWERS.length];

  return { intake, reviewer };
}