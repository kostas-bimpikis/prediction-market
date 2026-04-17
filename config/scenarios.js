const SCENARIO_CONFIG = [
  {
    id: "s0",
    title: "Warm-up: Rain in Palo Alto",
    question: "Will it rain in Palo Alto tomorrow?",
    description:
      "A simple warm-up scenario so students can get comfortable with the trading interface before real rounds begin. Signals are moderately informative.",
    prior: 0.5,
    liquidity: 50,
    durationSeconds: 180,
    mode: "practice",
    signalDisplayMode: "exact",
    signalLevels: [
      { label: "Weather watcher", accuracy: 0.6, weight: 1.0 },
    ],
    teachingPoint:
      "Testing / warm-up scenario. Every student receives a signal with accuracy q=0.60. Use this round to let students practice joining, reading their signal, placing trades, and seeing the post-round summary before the scored rounds begin.",
    manipulationEnabled: false,
  },
  {
    id: "s1",
    title: "Tour de France: Vingegaard",
    question: "Will Jonas Vingegaard win this year's Tour de France?",
    description:
      "Jonas Vingegaard enters this year's Tour de France as a top contender. Cycling analysts are split on whether he can beat the field. Each student has a private read on his form and the race dynamics.",
    prior: 0.5,
    liquidity: 50,
    durationSeconds: 300,
    mode: "scored",
    signalDisplayMode: "exact",
    signalLevels: [{ label: "Cycling analyst", accuracy: 0.56, weight: 1.0 }],
    teachingPoint:
      "Baseline information aggregation. Each individual signal is weak (56% accuracy), but 60 independent signals aggregate into a decisive posterior. The market should converge toward truth despite individual uncertainty.",
    manipulationEnabled: false,
  },
  {
    id: "s2",
    title: "BTS at Coachella 2027",
    question: "Will BTS headline Coachella 2027?",
    description:
      "Rumors are swirling about the 2027 Coachella lineup. Fans and industry watchers are speculating whether BTS will be announced as a headliner. The evidence is thin and sources vary widely in quality.",
    prior: 0.5,
    liquidity: 50,
    durationSeconds: 300,
    mode: "scored",
    signalDisplayMode: "exact",
    signalLevels: [
      { label: "Social media rumor", accuracy: 0.52, weight: 0.6 },
      { label: "Music industry contact", accuracy: 0.55, weight: 0.3 },
      { label: "Festival insider", accuracy: 0.6, weight: 0.1 },
    ],
    teachingPoint:
      "Sparse information environment. Most signals are barely better than noise. Even with perfect aggregation the Bayesian posterior stays ambiguous (typically 65-72% with 60 students). The market cannot resolve the question — not because the mechanism failed, but because the available information is insufficient.",
    manipulationEnabled: false,
  },
  {
    id: "s3",
    title: "CA Governor Race: Reyes vs. Whitaker",
    question:
      "Will Morgan Reyes defeat Elena Whitaker in the California governor race?",
    description:
      "The California governor race between Morgan Reyes and Elena Whitaker is too close to call. Analysts are split on the likely winner. Meanwhile, a well-funded group may be trying to move the market in one direction.",
    prior: 0.5,
    liquidity: 50,
    durationSeconds: 300,
    mode: "scored",
    signalDisplayMode: "exact",
    signalLevels: [
      { label: "Poll respondent", accuracy: 0.52, weight: 0.75 },
      { label: "Political commentator", accuracy: 0.58, weight: 0.2 },
      { label: "Campaign strategist", accuracy: 0.7, weight: 0.05 },
    ],
    teachingPoint:
      "Heterogeneous information — most students see barely-informative polls, a few hear a moderately informed commentator, and ~1 in 20 gets a genuinely informed campaign strategist signal. Students see exact posteriors, so aggregation should work well (benchmark ~85% with 60 students). But a hidden manipulator with a limited budget is trading against the truth. Can informed traders correct the price distortion? How much does the manipulator need to spend, and do they run out of ammo?",
    manipulationEnabled: true,
    manipulationBudget: 600,
  },
];

/**
 * Build a human-readable description of the signal structure for a scenario.
 * Used both on the instructor panel (always visible) and in the student
 * post-round summary (after resolution) to help with debrief.
 */
function describeSignalStructure(scenario) {
  if (!scenario) return "";
  const levels = scenario.signalLevels || [];
  if (levels.length === 1) {
    const t = levels[0];
    const pct = Math.round(t.accuracy * 100);
    return `Every student receives a signal from a "${t.label}" with accuracy q = ${t.accuracy} (correct ${pct}% of the time).`;
  }
  const parts = levels.map((t) => {
    const wpct = Math.round(t.weight * 100);
    return `${wpct}% get a "${t.label}" (q = ${t.accuracy}, correct ${Math.round(
      t.accuracy * 100
    )}%)`;
  });
  return `Signals are heterogeneous: ${parts.join("; ")}.`;
}

function getScenario(id) {
  return SCENARIO_CONFIG.find((s) => s.id === id);
}

module.exports = { SCENARIO_CONFIG, getScenario, describeSignalStructure };
