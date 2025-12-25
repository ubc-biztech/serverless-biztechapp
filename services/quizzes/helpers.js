export default {
  /**
     * Calculates the average of an array of scores
     * @param {Array} scores
     * @returns {number}
     */
  calculateAverage: function (scores) {
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  },

  /**
   * Validate question score
   * @param {Array} scores 
   * @returns {boolean}
   */
  validateQuestionScores: function (scores) {
    return Array.isArray(scores) && scores.length > 0 && scores.every(score => typeof score === "number" && score >= 0 && score <= 10);  
  },

  /**
     * Generates BizTech MBTI type from average scores
     * @param {number} domainAvg       // Tech (0) -> Business (10)
     * @param {number} modeAvg         // Maker (0) -> Director (10)
     * @param {number} environmentAvg  // Founder (0) -> Scaler (10)
     * @param {number} focusAvg        // Logic (0) -> Human (10)
     * @returns {string} e.g. "TMSH"
     */
  generateMBTI(domainAvg, modeAvg, environmentAvg, focusAvg) {
    const pick = (avg, low, high) => (avg <= 4 ? low : high);

    const domain = pick(domainAvg, "T", "B");
    const mode = pick(modeAvg, "M", "D");
    const environment = pick(environmentAvg, "F", "S");
    const focus = pick(focusAvg, "L", "H");

    return `${domain}${mode}${environment}${focus}`;
  }
};
