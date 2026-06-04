export const TODAY = new Date().toISOString().slice(0, 10);
export function nYearsAgo(n: number): string {
  return new Date(Date.now() - n * 365 * 86_400_000).toISOString().slice(0, 10);
}
export const TWO_YEARS_AGO = nYearsAgo(2);
