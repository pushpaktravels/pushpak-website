// ============================================================
// TierBadge — single source of truth for the tier pill UI.
// Tier A=Recents, B=Due, C=Overdue, D=Doubtful, E=Legal.
// Color tokens defined in globals.css.
// ============================================================
export function TierBadge({ tier }: { tier: string | null | undefined }) {
  const t = (tier || 'A').toUpperCase();
  return <span className={`tier tier-${t}`}>{t}</span>;
}

export function TierLabel({ tier }: { tier: string }) {
  const labels: Record<string, string> = {
    A: 'Recents', B: 'Due', C: 'Overdue', D: 'Doubtful', E: 'Legal',
  };
  return <>{labels[tier.toUpperCase()] || '—'}</>;
}
