/** Entity resolution helpers: is "J. Smith" the same resident as "John Smith"? */

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[-'’]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

const ratio = (a: string, b: string) => (a.length || b.length ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 0);

/**
 * 0–1 similarity between two person names.
 *  1.00 same name · 0.90 same last name + matching first initial · 0.95 small typo
 *  0.50 same last name, different first name · ≤0.60 different last names
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = na.split(" ");
  const tb = nb.split(" ");
  const la = ta[ta.length - 1];
  const lb = tb[tb.length - 1];
  const fa = ta.length > 1 ? ta[0] : "";
  const fb = tb.length > 1 ? tb[0] : "";
  const lastSame = la === lb || (la.length > 4 && ratio(la, lb) >= 0.85);
  if (lastSame) {
    if (!fa || !fb) return 0.8; // only a last name on one side
    if (fa === fb) return la === lb ? 1 : 0.95;
    if ((fa.length === 1 || fb.length === 1) && fa[0] === fb[0]) return 0.9;
    if (ratio(fa, fb) >= 0.8) return 0.95;
    return 0.5;
  }
  return Math.min(0.6, ratio(na, nb));
}

/** Best similarity between a payer string and any resident on a lease. */
export function bestNameMatch(payer: string, residents: string[]): { score: number; resident: string | null } {
  let best = { score: 0, resident: null as string | null };
  for (const r of residents) {
    const s = nameSimilarity(payer, r);
    if (s > best.score) best = { score: s, resident: r };
  }
  return best;
}
