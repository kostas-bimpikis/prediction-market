/**
 * LMSR (Logarithmic Market Scoring Rule) automated market maker.
 * All formulas use numerically stable forms to avoid exp() overflow.
 */

/**
 * YES price using sigmoid form: P_yes = 1 / (1 + exp((q_no - q_yes) / b))
 */
function yesPrice(qYes, qNo, b) {
  const diff = (qNo - qYes) / b;
  return 1 / (1 + Math.exp(diff));
}

/**
 * NO price = 1 - YES price
 */
function noPrice(qYes, qNo, b) {
  return 1 - yesPrice(qYes, qNo, b);
}

/**
 * Cost function using log-sum-exp trick:
 * C = max(q_yes, q_no) + b * ln(1 + exp(-|q_yes - q_no| / b))
 */
function cost(qYes, qNo, b) {
  const m = Math.max(qYes, qNo);
  const absDiff = Math.abs(qYes - qNo);
  return m + b * Math.log(1 + Math.exp(-absDiff / b));
}

/**
 * Compute shares received for a given spend on YES side.
 *
 * Formula (from spec): shares = b * ln(((A + B) * exp(S/b) - B) / A)
 * where A = exp(q_yes/b), B = exp(q_no/b)
 *
 * Numerically stable version: factor out max exponent.
 * Let m = max(q_yes, q_no) / b
 * a = exp(q_yes/b - m), c = exp(q_no/b - m)
 * shares = b * ln(((a + c) * exp(S/b) - c) / a)
 */
function sharesForSpend(qYes, qNo, b, spend, side) {
  if (spend <= 0) return 0;

  let qBuy, qOther;
  if (side === "YES") {
    qBuy = qYes;
    qOther = qNo;
  } else {
    qBuy = qNo;
    qOther = qYes;
  }

  const m = Math.max(qBuy, qOther) / b;
  const a = Math.exp(qBuy / b - m);
  const c = Math.exp(qOther / b - m);
  const expS = Math.exp(spend / b);

  const shares = b * Math.log(((a + c) * expS - c) / a);
  return shares;
}

/**
 * Compute the cost of buying a specific number of shares.
 * cost_of_shares = C(q_buy + shares, q_other) - C(q_buy, q_other)
 */
function costForShares(qYes, qNo, b, shares, side) {
  let newQYes = qYes;
  let newQNo = qNo;
  if (side === "YES") {
    newQYes += shares;
  } else {
    newQNo += shares;
  }
  return cost(newQYes, newQNo, b) - cost(qYes, qNo, b);
}

/**
 * Initialize LMSR state for a given prior.
 * q_yes = b * ln(p0 / (1 - p0)), q_no = 0
 * With p0 = 0.50: q_yes = 0, q_no = 0
 */
function initialState(prior, b) {
  if (prior === 0.5) {
    return { qYes: 0, qNo: 0 };
  }
  const qYes = b * Math.log(prior / (1 - prior));
  return { qYes, qNo: 0 };
}

module.exports = {
  yesPrice,
  noPrice,
  cost,
  sharesForSpend,
  costForShares,
  initialState,
};
