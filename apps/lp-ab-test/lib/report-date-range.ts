/**
 * Default period is "this month" (docs/lp-ab-test/00-requirements.md 6).
 * `to` is treated as an exclusive upper bound one day past the given end
 * date, so a UI date picker's "to" day is fully included.
 */
export function resolveDateRange(fromParam: string | null, toParam: string | null): { from: string; to: string } {
  if (fromParam && toParam) {
    const to = new Date(`${toParam}T00:00:00.000Z`);
    to.setUTCDate(to.getUTCDate() + 1);
    return { from: `${fromParam}T00:00:00.000Z`, to: to.toISOString() };
  }
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: from.toISOString(), to: to.toISOString() };
}
