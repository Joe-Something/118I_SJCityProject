export function isDemoSeedApplicationId(id: string): boolean {
  return /^DEMO-D2-\d{4}$/.test(id);
}