/**
 * The seller's canned answers in the due-diligence Q&A (moved unchanged from App.tsx
 * so the game store can use it without importing a React component).
 *
 * The answer is chosen by keyword, so the same question always gets the same reply.
 * That keeps the deal deterministic: nothing here draws random numbers.
 */
export const STARTER_QUESTIONS = [
  'Who runs the stand?',
  'When does the lease renew?',
  'Why are you selling?',
];

export function answerSellerQuestion(q: string): string {
  const lower = q.toLowerCase();
  if (lower.includes('manager') || lower.includes('staff') || lower.includes('who runs') || lower.includes('wage')) {
    return "I've been hands-on since day one—nothing beats an owner's touch, so manager pay is $0 on the books. Sales still grew from $14 to $16 a day.";
  }
  if (lower.includes('lease') || lower.includes('rent') || lower.includes('renew')) {
    return 'Lease renews in 4 days—the landlord mentioned rent is stepping up from $3 to $5 a day on renewal. Still a prime brownstone corner.';
  }
  if (lower.includes('why') || lower.includes('sell') || lower.includes('leav')) {
    return "I'm moving to Brooklyn next week and don't want to commute uptown. Revenue hit $16 a day last period.";
  }
  return "Every number I have is right there on the sheet—sales went $14, $15, $16 a day. Ask me about staffing, the lease, or why I'm selling.";
}
