/**
 * Signal generation, posterior computation, and Bayesian benchmark.
 */

/**
 * Assign a signal tier based on weighted random selection.
 * Returns the chosen tier object { label, accuracy, weight }.
 */
function assignTier(signalLevels) {
  const r = Math.random();
  let cumulative = 0;
  for (const tier of signalLevels) {
    cumulative += tier.weight;
    if (r < cumulative) return tier;
  }
  return signalLevels[signalLevels.length - 1];
}

/**
 * Generate a signal given the true state and signal accuracy.
 * P(signal = omega | omega) = accuracy
 */
function generateSignal(trueState, accuracy) {
  const r = Math.random();
  if (trueState === "YES") {
    return r < accuracy ? "YES" : "NO";
  } else {
    return r < accuracy ? "NO" : "YES";
  }
}

/**
 * Compute exact posterior P(YES | signal) given prior and accuracy.
 * With p0 = 0.50:
 *   P(YES | signal=YES) = accuracy
 *   P(YES | signal=NO) = 1 - accuracy
 */
function exactPosterior(signal, accuracy, prior) {
  if (signal === "YES") {
    const num = prior * accuracy;
    const denom = prior * accuracy + (1 - prior) * (1 - accuracy);
    return num / denom;
  } else {
    const num = prior * (1 - accuracy);
    const denom = prior * (1 - accuracy) + (1 - prior) * accuracy;
    return num / denom;
  }
}

/**
 * Convert posterior to coarse confidence label.
 * Confidence = posterior probability that the signaled outcome is correct.
 * For a YES signal: confidence = posteriorYes
 * For a NO signal: confidence = 1 - posteriorYes (= posteriorNo)
 */
function coarseConfidence(signal, posteriorYes) {
  const confidence = signal === "YES" ? posteriorYes : 1 - posteriorYes;
  if (confidence > 0.8) return "HIGH";
  if (confidence >= 0.6) return "MEDIUM";
  return "LOW";
}

/**
 * Compute Bayesian benchmark: the posterior given ALL signals.
 * Uses logit aggregation:
 *   logit P(YES | all) = logit(prior) + sum_i contribution_i
 * where:
 *   contribution_i = +ln(q_i / (1-q_i)) if s_i = YES
 *   contribution_i = -ln(q_i / (1-q_i)) if s_i = NO
 *
 * @param {Array<{signal: string, accuracy: number}>} signals
 * @param {number} prior
 * @returns {number} P(YES | all signals)
 */
function bayesianBenchmark(signals, prior) {
  if (signals.length === 0) return prior;

  let logOdds = Math.log(prior / (1 - prior));

  for (const { signal, accuracy } of signals) {
    const logLR = Math.log(accuracy / (1 - accuracy));
    if (signal === "YES") {
      logOdds += logLR;
    } else {
      logOdds -= logLR;
    }
  }

  return 1 / (1 + Math.exp(-logOdds));
}

/**
 * Generate a complete player signal for a round.
 * Returns { signal, accuracy, label, posteriorYes, confidenceLabel }.
 */
function generatePlayerSignal(trueState, signalLevels, prior, displayMode) {
  const tier = assignTier(signalLevels);
  const signal = generateSignal(trueState, tier.accuracy);
  const posteriorYes = exactPosterior(signal, tier.accuracy, prior);
  const confidenceLabel =
    displayMode === "coarse" ? coarseConfidence(signal, posteriorYes) : null;

  return {
    signal,
    accuracy: tier.accuracy,
    label: tier.label,
    posteriorYes,
    confidenceLabel,
  };
}

module.exports = {
  assignTier,
  generateSignal,
  exactPosterior,
  coarseConfidence,
  bayesianBenchmark,
  generatePlayerSignal,
};
