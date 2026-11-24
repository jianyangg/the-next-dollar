import type { PublicDealView, SellerPersona } from './types.ts';

/**
 * The Central Park seller's PUBLIC deal data: what the player and the AI seller may
 * see. Moved here from src/core/deal.ts so the server can own it. The hidden
 * minimum (reservationPrice) is NOT here; src/core/deal.ts adds it on the client side.
 * Every number and fact is copied unchanged from the original hard-coded deal.
 */
export const CENTRAL_PARK_PUBLIC_DEAL: PublicDealView = {
  id: 'central-park-seller-1',
  neighborhood: 'central-park',
  askingPrice: 60,
  books: [
    { label: '2 periods ago', sales: 14, lemons: 5, managerWage: 0, rent: 3, profit: 6 },
    { label: 'Last period', sales: 15, lemons: 5, managerWage: 0, rent: 3, profit: 7 },
    { label: 'Latest', sales: 16, lemons: 5, managerWage: 0, rent: 3, profit: 8 },
  ],
  offBookFacts: [
    {
      id: 'owner-unpaid-labour',
      topic: 'staffing',
      statement: 'The owner runs the stand personally, so manager pay is $0 on the books.',
      figures: [0],
    },
    {
      id: 'lease-rent-step-up',
      topic: 'lease',
      statement: 'The lease renews in 4 days and rent rises from $3 to $5 a day on renewal.',
      figures: [4, 3, 5],
    },
    {
      id: 'moving-to-brooklyn',
      topic: 'reason-for-selling',
      statement: 'The seller is moving to Brooklyn next week and does not want to commute uptown.',
      figures: [],
    },
  ],
};

// DRAFT persona — the game designer will edit this
// Drafted only from the seller's existing dialogue in src/core/sellerQuestions.ts
// (hands-on owner, prime brownstone corner on Central Park, steady $14 -> $16 growth).
export const CENTRAL_PARK_PERSONA: SellerPersona = {
  name: 'Dana Reyes',
  location: 'a brownstone corner by Central Park',
  manner: 'warm and chatty, proud of the corner, keeps steering back to the steady sales growth',
};
