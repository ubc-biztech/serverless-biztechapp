// Product Plus rubric contract.
export const PRODUCT_PLUS_RUBRIC_CRITERIA = [
  { label: "Problem Definition", weight: 25 },
  { label: "Problem-Solution Fit", weight: 25 },
  { label: "Business Viability", weight: 25 },
  { label: "Research & Supporting Evidence", weight: 15 },
  { label: "Video Pitch & Creativity", weight: 10 }
] as const;
export const PRODUCT_PLUS_RUBRIC_SCORE_COUNT = PRODUCT_PLUS_RUBRIC_CRITERIA.length;
export const PRODUCT_PLUS_RUBRIC_SCORE_MAX = 10;

export const WEIGHTS = {
  ORIGINAL: 0.15,
  TECHNICAL: 0.4,
  UX: 0.15,
  PROBLEMSOLVING: 0.2,
  PRESENTATION: 0.1,
} as const;

export const ROUND = "CURRENT_ROUND";

export const JUDGING_ROUNDS = ["prelim", "finals"] as const;
