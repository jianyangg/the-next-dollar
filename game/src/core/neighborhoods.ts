export type NeighborhoodId =
  | 'central-park'
  | 'columbia'
  | 'broadway'
  | 'market'
  | 'west-village'
  | 'fidi'
  | 'fifth-ave';

export interface NeighborhoodTheme {
  skyHex: string;
  fogHex: string;
  buildingBase: string;
  buildingDark: string;
  awningHex: string;
  accentHex: string;
}

export interface NeighborhoodConfig {
  id: NeighborhoodId;
  name: string;
  shortName: string;
  streetSignA: string;
  streetSignB: string;
  /** Rent per day of this district's CORNER plot (side streets and plazas scale from it, core/plots.ts). */
  dailyRent: number;
  /**
   * Passers-by who reach this district's CORNER stand in a full day (side streets and
   * plazas scale from it, core/plots.ts). Busier districts cost more rent; whether the
   * extra crowd is worth the extra rent depends on the price they will pay.
   */
  cornerWalkersPerDay: number;
  /**
   * One-off city permit paid when a lease is signed on any plot in this district
   * (core/purchases.ts `leaseFee`). Free in Central Park, where every run starts, and
   * dearer the busier the district. It is what makes a downtown stand a real investment:
   * the money is gone the moment it is paid (a permit cannot be resold), so the stand
   * has to earn it back in the days that are left.
   */
  permitFee: number;
  /**
   * How sweet this district's customers like their lemonade, 0 (tart) .. 1 (very sweet).
   * It is the target on the brew's taste meter (core/minigames/sweeten.ts), so moving
   * to a new district means learning a new taste. Students and tourists like it sweet;
   * the finance crowd and the Village like it tart.
   */
  sweetTooth: number;
  typicalPrice: string;
  crowdLabel: string;
  description: string;
  priceSensitivity: number;
  hasSellerDeal: boolean;
  mapPos: { x: number; y: number };
  theme: NeighborhoodTheme;
}

export const NEIGHBORHOODS: NeighborhoodConfig[] = [
  {
    id: 'columbia',
    name: 'Columbia University',
    shortName: 'Columbia',
    streetSignA: 'BROADWAY',
    streetSignB: 'W 116 ST',
    dailyRent: 10,
    cornerWalkersPerDay: 36,
    permitFee: 30,
    sweetTooth: 0.7,
    typicalPrice: '$3',
    crowdLabel: 'Students & Loyal Regulars',
    description:
      'Morningside Heights campus walk filled with budget-conscious students and reliable daily regulars.',
    priceSensitivity: 1.05,
    hasSellerDeal: false,
    mapPos: { x: 58, y: 16 },
    theme: {
      skyHex: '#94c4e8',
      fogHex: '#d4e4f2',
      buildingBase: '#a95c48',
      buildingDark: '#6d3b2e',
      awningHex: '#5b9bd5',
      accentHex: '#60a5fa',
    },
  },
  {
    id: 'central-park',
    name: 'Central Park',
    shortName: 'Central Park',
    streetSignA: 'CENTRAL PARK W',
    streetSignB: 'W 72 ST',
    dailyRent: 4,
    cornerWalkersPerDay: 36,
    permitFee: 0,
    sweetTooth: 0.6,
    typicalPrice: '$2–$3',
    crowdLabel: 'Families & Park Walkers',
    description:
      'Sunny park-edge corner with value-minded families, joggers, and low daily rent ideal for learning the ropes.',
    priceSensitivity: 1.1,
    hasSellerDeal: true,
    mapPos: { x: 49, y: 34 },
    theme: {
      skyHex: '#8ec5ea',
      fogHex: '#cfe5f5',
      buildingBase: '#b66e52',
      buildingDark: '#7a4635',
      awningHex: '#e8b931',
      accentHex: '#4ade80',
    },
  },
  {
    id: 'fifth-ave',
    name: 'Fifth Avenue',
    shortName: 'Fifth Ave',
    streetSignA: '5 AVE',
    streetSignB: 'E 57 ST',
    dailyRent: 44,
    cornerWalkersPerDay: 62,
    permitFee: 150,
    sweetTooth: 0.4,
    typicalPrice: '$5',
    crowdLabel: 'Luxury Shoppers & Visitors',
    description:
      'Flagship corridor by the Plaza where shoppers and visitors gladly pay top dollar for quality.',
    priceSensitivity: 0.84,
    hasSellerDeal: false,
    mapPos: { x: 58, y: 44 },
    theme: {
      skyHex: '#98c6e8',
      fogHex: '#e6dfd3',
      buildingBase: '#c9bfa8',
      buildingDark: '#877d6a',
      awningHex: '#d4a024',
      accentHex: '#f5c84c',
    },
  },
  {
    id: 'broadway',
    name: 'Broadway',
    shortName: 'Broadway',
    streetSignA: 'BROADWAY',
    streetSignB: 'W 44 ST',
    dailyRent: 18,
    cornerWalkersPerDay: 40,
    permitFee: 60,
    sweetTooth: 0.65,
    typicalPrice: '$3–$4',
    crowdLabel: 'Theatergoers in a Rush',
    description:
      'Bustling Theater District block where matinee and evening crowds buy quickly before curtain call.',
    priceSensitivity: 0.98,
    hasSellerDeal: false,
    mapPos: { x: 43, y: 53 },
    theme: {
      skyHex: '#7ba6d6',
      fogHex: '#c9d4e8',
      buildingBase: '#7e6b8f',
      buildingDark: '#4c3f59',
      awningHex: '#e04f5f',
      accentHex: '#fb7185',
    },
  },
  {
    id: 'market',
    name: 'Union Square Supply Market',
    shortName: 'Supply Market',
    streetSignA: 'E 14 ST',
    streetSignB: 'BROADWAY',
    dailyRent: 0,
    cornerWalkersPerDay: 0,
    permitFee: 0,
    sweetTooth: 0.5,
    typicalPrice: 'Wholesale',
    crowdLabel: 'Lemon & Pitcher Vendors',
    description:
      'Lively Union Square open-air market where wholesale stalls sell fresh lemons and gleaming pitchers with zero daily rent.',
    priceSensitivity: 1.0,
    hasSellerDeal: false,
    mapPos: { x: 47, y: 61 },
    theme: {
      skyHex: '#93d1f0',
      fogHex: '#e8eed8',
      buildingBase: '#c87d4b',
      buildingDark: '#844d2a',
      awningHex: '#22c55e',
      accentHex: '#22c55e',
    },
  },
  {
    id: 'west-village',
    name: 'West Village',
    shortName: 'West Village',
    streetSignA: 'BLEECKER ST',
    streetSignB: 'W 4 ST',
    dailyRent: 28,
    cornerWalkersPerDay: 46,
    permitFee: 90,
    sweetTooth: 0.35,
    typicalPrice: '$4',
    crowdLabel: 'Quality-First Locals',
    description:
      'Charming brownstone streets where discerning locals pay for a great drink and come back every afternoon.',
    priceSensitivity: 0.88,
    hasSellerDeal: true,
    mapPos: { x: 36, y: 73 },
    theme: {
      skyHex: '#a2c4df',
      fogHex: '#e4d8cc',
      buildingBase: '#9e5b46',
      buildingDark: '#63372a',
      awningHex: '#2d9d8f',
      accentHex: '#2dd4bf',
    },
  },
  {
    id: 'fidi',
    name: 'Financial District',
    shortName: 'FiDi',
    streetSignA: 'WALL ST',
    streetSignB: 'BROAD ST',
    dailyRent: 36,
    cornerWalkersPerDay: 54,
    permitFee: 120,
    sweetTooth: 0.3,
    typicalPrice: '$4–$5',
    crowdLabel: 'Fast-Moving Office Pros',
    description:
      'High-velocity downtown canyon of bankers and analysts who want fast service and tolerate higher prices.',
    priceSensitivity: 0.87,
    hasSellerDeal: true,
    mapPos: { x: 40, y: 88 },
    theme: {
      skyHex: '#84aec9',
      fogHex: '#cbd8e3',
      buildingBase: '#6d7d8f',
      buildingDark: '#414d5c',
      awningHex: '#3b82f6',
      accentHex: '#38bdf8',
    },
  },
];

const NEIGHBORHOOD_BY_ID: Record<NeighborhoodId, NeighborhoodConfig> =
  NEIGHBORHOODS.reduce(
    (acc, item) => {
      acc[item.id] = item;
      return acc;
    },
    {} as Record<NeighborhoodId, NeighborhoodConfig>,
  );

export function getNeighborhood(id: NeighborhoodId): NeighborhoodConfig {
  return NEIGHBORHOOD_BY_ID[id] ?? NEIGHBORHOOD_BY_ID['central-park'];
}
