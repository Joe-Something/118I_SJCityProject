export function isStaleWrite(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error && error.status === 409;
}