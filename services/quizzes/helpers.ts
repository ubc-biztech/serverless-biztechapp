/**
 * Calculates the average of an array of scores
 */
export function calculateAverage(scores: number[]): number {
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * Validate question score
 */
export function validateQuestionScores(scores: unknown): scores is number[] {
  return (
    Array.isArray(scores) &&
    scores.length > 0 &&
    scores.every(
      (score) => typeof score === "number" && score >= 0 && score <= 10,
    )
  );
}

/**
 * Generates BizTech MBTI type from average scores
 */
export function generateMBTI(
  domainAvg: number,
  modeAvg: number,
  environmentAvg: number,
  focusAvg: number,
): string {
  const pick = (avg: number, low: string, high: string) => (avg <= 4 ? low : high);

  const domain = pick(domainAvg, "T", "B");
  const mode = pick(modeAvg, "M", "D");
  const environment = pick(environmentAvg, "F", "S");
  const focus = pick(focusAvg, "L", "H");

  return `${domain}${mode}${environment}${focus}`;
}
