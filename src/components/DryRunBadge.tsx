/** Shown wherever a delete could happen while deletes are simulated. */
export function DryRunBadge({ dryRun }: { dryRun: boolean }) {
  if (!dryRun) return null;
  return <p className="badge t-label">Dry run · nothing is deleted</p>;
}
