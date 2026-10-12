export interface PointsRules {
  version: string; currency: 'BDT'; earnSpend: number; pointValue: number;
  minimumRedemption: number; maximumRedemptionPercent: number; expiryMonths: number; releaseDays: number;
}
export const FLYSERI_POINTS_RULES: PointsRules = Object.freeze({ version: 'BDT-1000-v1', currency: 'BDT',
  earnSpend: 1000, pointValue: 1, minimumRedemption: 100, maximumRedemptionPercent: 10, expiryMonths: 12, releaseDays: 7 });
export interface PointsActivity {
  id: string; kind: string; points: number; description: string; createdAt: string; orderId: string | null;
}
export interface PointsWallet {
  rules: PointsRules; available: number; pending: number; reserved: number; adjustmentDue: number;
  expiring: { points: number; expiresAt: string } | null;
  activity: PointsActivity[]; page: number; hasMore: boolean;
}
export interface PointsQuote {
  orderId: string; eligible: boolean; message: string; available: number; maximum: number;
  applied: number; estimatedEarn: number; eligibleAmount: string; rules: PointsRules;
}
