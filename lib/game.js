const { v4: uuidv4 } = require("uuid");
const lmsr = require("./lmsr");
const signals = require("./signals");
const { getScenario, describeSignalStructure } = require("../config/scenarios");

// ---------------------------------------------------------------------------
// In-memory game state
// ---------------------------------------------------------------------------
let currentRound = null;
let players = new Map(); // playerId -> Player
let trades = []; // student trades
let manipulationTrades = []; // instructor manipulation trades
let priceHistory = []; // { time, price, tradeIndex }
const cumulativeStandings = new Map(); // normalizedName -> CumulativeStanding

// Timer state
let timerInterval = null;
let remainingSeconds = 0;

// Whether the top-5 leaderboard is revealed to students. Instructor always
// sees the full cumulative leaderboard; students see top-5 only when this
// flag is true. Toggled from the instructor panel.
let showStudentLeaderboard = false;

// SSE broadcast function (set by server.js)
let broadcastFn = null;

function setBroadcast(fn) {
  broadcastFn = fn;
}

function broadcast(event, data) {
  if (broadcastFn) broadcastFn(event, data);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normalizeName(name) {
  return name.trim().toLowerCase();
}

function now() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------
/**
 * Wipe all game state — cumulative standings, active round, players, trades.
 * Use this between two separate classroom sessions with different students.
 * Returns a summary of what was cleared.
 */
function newSession() {
  clearTimer();

  const summary = {
    standingsCleared: cumulativeStandings.size,
    hadActiveRound: currentRound !== null,
  };

  currentRound = null;
  players = new Map();
  trades = [];
  manipulationTrades = [];
  priceHistory = [];
  remainingSeconds = 0;
  cumulativeStandings.clear();
  showStudentLeaderboard = false;

  broadcast("reset", { round: null });
  return summary;
}

/**
 * Toggle whether students can see the top-5 cumulative leaderboard.
 * Instructor always sees the full leaderboard regardless of this flag.
 */
function toggleStudentLeaderboard(explicit) {
  if (typeof explicit === "boolean") {
    showStudentLeaderboard = explicit;
  } else {
    showStudentLeaderboard = !showStudentLeaderboard;
  }
  broadcast("leaderboard-visibility", {
    showStudentLeaderboard,
  });
  return showStudentLeaderboard;
}

function getShowStudentLeaderboard() {
  return showStudentLeaderboard;
}

function resetRound(scenarioId, mode, options = {}) {
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);

  clearTimer();

  const { qYes, qNo } = lmsr.initialState(scenario.prior, scenario.liquidity);

  // Manipulation budget: instructor override > scenario config > default 600
  let manipBudget = 0;
  if (scenario.manipulationEnabled) {
    if (
      options.manipulationBudget != null &&
      !isNaN(Number(options.manipulationBudget)) &&
      Number(options.manipulationBudget) > 0
    ) {
      manipBudget = Number(options.manipulationBudget);
    } else {
      manipBudget = scenario.manipulationBudget || 600;
    }
  }

  // Mode is always derived from the scenario config (S0 = practice, S1-S3 = scored)
  const resolvedMode = scenario.mode || mode || "practice";

  currentRound = {
    id: uuidv4(),
    scenarioId,
    roundNumber: currentRound ? currentRound.roundNumber + 1 : 1,
    mode: resolvedMode,
    prior: scenario.prior,
    liquidity: scenario.liquidity,
    hiddenOutcome: Math.random() < scenario.prior ? "YES" : "NO",
    status: "closed",
    showStudentPriceChart: false,
    startedAt: null,
    endsAt: null,
    resolvedAt: null,
    qYes,
    qNo,
    tradeCount: 0,
    resultsRecorded: false,
    durationSeconds: scenario.durationSeconds,
    manipulationBudget: manipBudget,
    manipulationSpent: 0,
  };

  players = new Map();
  trades = [];
  manipulationTrades = [];
  priceHistory = [
    {
      time: now(),
      price: lmsr.yesPrice(qYes, qNo, scenario.liquidity),
      tradeIndex: 0,
    },
  ];

  broadcast("reset", { round: getPublicRound() });
  return currentRound;
}

function openTrading(options = {}) {
  if (!currentRound) throw new Error("No active round");
  if (currentRound.status === "resolved")
    throw new Error("Round already resolved");

  if (options.showStudentPriceChart !== undefined) {
    currentRound.showStudentPriceChart = options.showStudentPriceChart;
  }

  const duration = options.durationSeconds || currentRound.durationSeconds;
  currentRound.status = "live";
  currentRound.startedAt = now();
  remainingSeconds = duration;
  currentRound.endsAt = new Date(
    Date.now() + duration * 1000
  ).toISOString();

  startTimer();
  broadcast("status-change", {
    status: "live",
    remainingSeconds,
    showStudentPriceChart: currentRound.showStudentPriceChart,
  });
  return currentRound;
}

function pauseTrading() {
  if (!currentRound || currentRound.status !== "live")
    throw new Error("Trading not live");

  clearTimer();
  currentRound.status = "paused";

  broadcast("status-change", { status: "paused", remainingSeconds });
  return currentRound;
}

function resumeTrading() {
  if (!currentRound || currentRound.status !== "paused")
    throw new Error("Trading not paused");

  currentRound.status = "live";
  currentRound.endsAt = new Date(
    Date.now() + remainingSeconds * 1000
  ).toISOString();

  startTimer();
  broadcast("status-change", { status: "live", remainingSeconds });
  return currentRound;
}

function resolveRound() {
  if (!currentRound) throw new Error("No active round");
  if (currentRound.status === "resolved")
    throw new Error("Round already resolved");

  clearTimer();
  currentRound.status = "resolved";
  currentRound.resolvedAt = now();

  // Compute payoffs for each player
  const outcome = currentRound.hiddenOutcome;
  const playerResults = [];

  for (const [pid, player] of players) {
    const winningShares =
      outcome === "YES" ? player.yesShares : player.noShares;
    const finalValue = player.cash + winningShares;
    const roundProfit = finalValue - 100;

    player.finalValue = finalValue;
    player.roundProfit = roundProfit;

    playerResults.push({
      playerId: pid,
      name: player.name,
      finalValue,
      roundProfit,
    });

    // Update cumulative standings for scored rounds (exactly once)
    if (currentRound.mode === "scored" && !currentRound.resultsRecorded) {
      const key = normalizeName(player.name);
      const standing = cumulativeStandings.get(key) || {
        normalizedName: key,
        displayName: player.name,
        cumulativeProfit: 0,
        roundsScored: 0,
        lastRoundProfit: 0,
      };
      standing.cumulativeProfit += roundProfit;
      standing.roundsScored += 1;
      standing.lastRoundProfit = roundProfit;
      standing.displayName = player.name; // update to latest display name
      cumulativeStandings.set(key, standing);
    }
  }

  currentRound.resultsRecorded = true;

  // Compute aggregate stats
  const totalYesSpend = trades
    .filter((t) => t.side === "YES")
    .reduce((sum, t) => sum + t.spend, 0);
  const totalNoSpend = trades
    .filter((t) => t.side === "NO")
    .reduce((sum, t) => sum + t.spend, 0);

  const finalPx = lmsr.yesPrice(
    currentRound.qYes,
    currentRound.qNo,
    currentRound.liquidity
  );
  const studentOnlyPx = computeStudentOnlyPrice();

  broadcast("resolved", {
    outcome,
    finalPrice: finalPx,
    studentOnlyPrice: studentOnlyPx,
    manipulationImpact: finalPx - studentOnlyPx,
    bayesianBenchmark: computeBayesianBenchmark(),
    totalTrades: trades.length,
    totalYesSpend: Math.round(totalYesSpend * 100) / 100,
    totalNoSpend: Math.round(totalNoSpend * 100) / 100,
    priceHistory,
    mode: currentRound.mode,
  });

  return { outcome, playerResults };
}

// ---------------------------------------------------------------------------
// Player management
// ---------------------------------------------------------------------------
function addPlayer(name) {
  if (!currentRound) throw new Error("No active round");
  if (currentRound.status === "resolved")
    throw new Error("Round already resolved");

  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Name is required");

  // Check for existing player with same name in this round (idempotent)
  for (const [pid, p] of players) {
    if (normalizeName(p.name) === normalizeName(trimmedName)) {
      return { player: p, playerId: pid, existing: true };
    }
  }

  const scenario = getScenario(currentRound.scenarioId);
  const signalData = signals.generatePlayerSignal(
    currentRound.hiddenOutcome,
    scenario.signalLevels,
    currentRound.prior,
    scenario.signalDisplayMode
  );

  const playerId = uuidv4();
  const player = {
    id: playerId,
    name: trimmedName,
    roundId: currentRound.id,
    cash: 100,
    yesShares: 0,
    noShares: 0,
    signal: signalData.signal,
    signalAccuracy: signalData.accuracy,
    signalLabel: signalData.label,
    posteriorYes: signalData.posteriorYes,
    confidenceLabel: signalData.confidenceLabel,
    joinedAt: now(),
    finalValue: null,
    roundProfit: null,
  };

  players.set(playerId, player);

  broadcast("player-joined", {
    playerCount: players.size,
    bayesianBenchmark: computeBayesianBenchmark(),
  });

  return { player, playerId, existing: false };
}

// ---------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------
function executeTrade(playerId, side, spend) {
  if (!currentRound) throw new Error("No active round");
  if (currentRound.status !== "live") throw new Error("Trading is not open");
  if (side !== "YES" && side !== "NO") throw new Error("Side must be YES or NO");
  if (spend <= 0) throw new Error("Spend must be positive");

  const player = players.get(playerId);
  if (!player) throw new Error("Player not found");
  if (spend > player.cash) throw new Error("Insufficient funds");

  const b = currentRound.liquidity;
  const priceBefore = lmsr.yesPrice(currentRound.qYes, currentRound.qNo, b);

  const shares = lmsr.sharesForSpend(
    currentRound.qYes,
    currentRound.qNo,
    b,
    spend,
    side
  );

  // Update market state
  if (side === "YES") {
    currentRound.qYes += shares;
    player.yesShares += shares;
  } else {
    currentRound.qNo += shares;
    player.noShares += shares;
  }
  player.cash -= spend;
  currentRound.tradeCount++;

  const priceAfter = lmsr.yesPrice(currentRound.qYes, currentRound.qNo, b);

  const trade = {
    id: uuidv4(),
    roundId: currentRound.id,
    playerId,
    actorType: "student",
    side,
    spend,
    shares,
    priceBefore,
    priceAfter,
    createdAt: now(),
    hiddenFromStudents: false,
  };

  trades.push(trade);
  priceHistory.push({
    time: trade.createdAt,
    price: priceAfter,
    tradeIndex: trades.length,
  });

  broadcast("trade", {
    price: priceAfter,
    tradeCount: currentRound.tradeCount,
    playerCount: players.size,
  });

  return trade;
}

function executeManipulation(side, spend) {
  if (!currentRound) throw new Error("No active round");
  if (currentRound.status !== "live") throw new Error("Trading is not open");

  const scenario = getScenario(currentRound.scenarioId);
  if (!scenario.manipulationEnabled)
    throw new Error("Manipulation not enabled for this scenario");

  // Enforce budget limit
  const budget = currentRound.manipulationBudget || 0;
  const spent = currentRound.manipulationSpent || 0;
  const remaining = budget - spent;
  if (spend > remaining) {
    throw new Error(
      `Manipulation budget exceeded. Remaining: ${remaining.toFixed(2)} credits (requested ${spend}).`
    );
  }

  const b = currentRound.liquidity;
  const priceBefore = lmsr.yesPrice(currentRound.qYes, currentRound.qNo, b);

  const shares = lmsr.sharesForSpend(
    currentRound.qYes,
    currentRound.qNo,
    b,
    spend,
    side
  );

  if (side === "YES") {
    currentRound.qYes += shares;
  } else {
    currentRound.qNo += shares;
  }

  const priceAfter = lmsr.yesPrice(currentRound.qYes, currentRound.qNo, b);

  const trade = {
    id: uuidv4(),
    roundId: currentRound.id,
    playerId: null,
    actorType: "instructor",
    side,
    spend,
    shares,
    priceBefore,
    priceAfter,
    createdAt: now(),
    hiddenFromStudents: true,
  };

  manipulationTrades.push(trade);
  currentRound.manipulationSpent = spent + spend;
  priceHistory.push({
    time: trade.createdAt,
    price: priceAfter,
    tradeIndex: trades.length + manipulationTrades.length,
  });

  // Broadcast price update (students see price change but not the trade)
  broadcast("trade", {
    price: priceAfter,
    tradeCount: currentRound.tradeCount, // does NOT increment for manipulation
    playerCount: players.size,
  });

  return trade;
}

// ---------------------------------------------------------------------------
// Bayesian benchmark
// ---------------------------------------------------------------------------
/**
 * Compute the price the market would show if ONLY student trades counted
 * (i.e., manipulation trades stripped out). Uses LMSR additivity:
 * total q = student q + manipulation q. Subtracting manipulator shares
 * gives the student-only state, and the sigmoid gives a clean proxy of
 * how well students aggregated their private signals — independent of
 * any manipulation pressure.
 */
function computeStudentOnlyPrice() {
  if (!currentRound) return 0.5;
  const studentQYes = Array.from(players.values()).reduce(
    (sum, p) => sum + p.yesShares,
    0
  );
  const studentQNo = Array.from(players.values()).reduce(
    (sum, p) => sum + p.noShares,
    0
  );
  return lmsr.yesPrice(studentQYes, studentQNo, currentRound.liquidity);
}

function computeBayesianBenchmark() {
  if (!currentRound || players.size === 0) {
    return currentRound ? currentRound.prior : 0.5;
  }

  const signalData = [];
  for (const [, p] of players) {
    signalData.push({ signal: p.signal, accuracy: p.signalAccuracy });
  }
  return signals.bayesianBenchmark(signalData, currentRound.prior);
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------
function startTimer() {
  clearTimer();
  // Timer counts down from durationSeconds and continues into negative
  // (overtime) until the instructor clicks Resolve. This avoids the
  // "closed but not resolved" state that could leave rounds unscored.
  // Cap at -3600 (1 hour overtime) as a sanity guard.
  timerInterval = setInterval(() => {
    remainingSeconds--;
    if (remainingSeconds <= -3600) {
      clearTimer();
    }
    broadcast("timer-tick", { remainingSeconds });
  }, 1000);
}

function clearTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// ---------------------------------------------------------------------------
// State accessors
// ---------------------------------------------------------------------------
function getStudentState(playerId) {
  if (!currentRound) return { round: null };

  const scenario = getScenario(currentRound.scenarioId);
  const isResolved = currentRound.status === "resolved";

  const round = getPublicRound();

  // Price history: only if chart enabled or resolved
  let studentPriceHistory = null;
  if (currentRound.showStudentPriceChart || isResolved) {
    studentPriceHistory = priceHistory;
  }

  // Post-resolution data
  let resolution = null;
  if (isResolved) {
    const totalYesSpend = trades
      .filter((t) => t.side === "YES")
      .reduce((sum, t) => sum + t.spend, 0);
    const totalNoSpend = trades
      .filter((t) => t.side === "NO")
      .reduce((sum, t) => sum + t.spend, 0);

    const finalPxStudent = lmsr.yesPrice(
      currentRound.qYes,
      currentRound.qNo,
      currentRound.liquidity
    );
    const studentOnlyPxStudent = computeStudentOnlyPrice();

    resolution = {
      outcome: currentRound.hiddenOutcome,
      finalPrice: finalPxStudent,
      studentOnlyPrice: studentOnlyPxStudent,
      manipulationImpact: finalPxStudent - studentOnlyPxStudent,
      manipulationEnabled: scenario.manipulationEnabled,
      manipulationSpent: currentRound.manipulationSpent || 0,
      bayesianBenchmark: computeBayesianBenchmark(),
      totalTrades: trades.length,
      totalYesSpend: Math.round(totalYesSpend * 100) / 100,
      totalNoSpend: Math.round(totalNoSpend * 100) / 100,
      signalStructure: describeSignalStructure(scenario),
      signalLevels: scenario.signalLevels,
    };
  }

  // Player data
  let player = null;
  let playerTrades = [];
  let cumulative = null;

  if (playerId && players.has(playerId)) {
    const p = players.get(playerId);
    const currentPrice = lmsr.yesPrice(
      currentRound.qYes,
      currentRound.qNo,
      currentRound.liquidity
    );

    let portfolioValue;
    if (isResolved) {
      portfolioValue = p.finalValue;
    } else {
      portfolioValue =
        p.cash + p.yesShares * currentPrice + p.noShares * (1 - currentPrice);
    }

    player = {
      id: p.id,
      name: p.name,
      cash: Math.round(p.cash * 100) / 100,
      yesShares: p.yesShares,
      noShares: p.noShares,
      signal: p.signal,
      signalLabel: p.signalLabel,
      portfolioValue: Math.round(portfolioValue * 100) / 100,
      joinedAt: p.joinedAt,
    };

    // Signal display depends on scenario
    if (scenario.signalDisplayMode === "exact") {
      player.posteriorYes =
        Math.round(p.posteriorYes * 1000) / 1000;
    } else {
      player.confidenceLabel = p.confidenceLabel;
    }

    if (isResolved) {
      player.finalValue = Math.round(p.finalValue * 100) / 100;
      player.roundProfit = Math.round(p.roundProfit * 100) / 100;
    }

    // Player's trades
    playerTrades = trades
      .filter((t) => t.playerId === playerId)
      .map((t) => ({
        side: t.side,
        spend: Math.round(t.spend * 100) / 100,
        shares: Math.round(t.shares * 1000) / 1000,
        priceAfter: Math.round(t.priceAfter * 1000) / 1000,
        createdAt: t.createdAt,
      }));

    // Cumulative standings
    const key = normalizeName(p.name);
    if (cumulativeStandings.has(key)) {
      const s = cumulativeStandings.get(key);
      cumulative = {
        cumulativeProfit: Math.round(s.cumulativeProfit * 100) / 100,
        roundsScored: s.roundsScored,
      };
    }
  }

  return {
    round,
    scenario: {
      id: scenario.id,
      title: scenario.title,
      question: scenario.question,
      description: scenario.description,
      prior: scenario.prior,
      signalDisplayMode: scenario.signalDisplayMode,
    },
    currentPrice: Math.round(
      lmsr.yesPrice(
        currentRound.qYes,
        currentRound.qNo,
        currentRound.liquidity
      ) * 1000
    ) / 1000,
    playerCount: players.size,
    tradeCount: currentRound.tradeCount,
    remainingSeconds,
    player,
    playerTrades,
    cumulative,
    topStandings: showStudentLeaderboard ? getTopStandings(5) : [],
    showStudentLeaderboard,
    priceHistory: studentPriceHistory,
    resolution,
  };
}

function getTopStandings(n = 5) {
  return Array.from(cumulativeStandings.values())
    .sort((a, b) => b.cumulativeProfit - a.cumulativeProfit)
    .slice(0, n)
    .map((s) => ({
      name: s.displayName,
      cumulativeProfit: Math.round(s.cumulativeProfit * 100) / 100,
      roundsScored: s.roundsScored,
    }));
}

function getInstructorState() {
  if (!currentRound) {
    return {
      round: null,
      showStudentLeaderboard,
      cumulativeLeaderboard: Array.from(cumulativeStandings.values())
        .sort((a, b) => b.cumulativeProfit - a.cumulativeProfit)
        .map((s) => ({
          name: s.displayName,
          cumulativeProfit: Math.round(s.cumulativeProfit * 100) / 100,
          roundsScored: s.roundsScored,
          lastRoundProfit: Math.round(s.lastRoundProfit * 100) / 100,
        })),
    };
  }

  const scenario = getScenario(currentRound.scenarioId);
  const b = currentRound.liquidity;
  const currentPrice = lmsr.yesPrice(currentRound.qYes, currentRound.qNo, b);

  // Signal distribution
  const signalDist = {};
  for (const [, p] of players) {
    const key = p.signalLabel;
    if (!signalDist[key]) {
      signalDist[key] = { label: key, accuracy: p.signalAccuracy, yes: 0, no: 0 };
    }
    if (p.signal === "YES") signalDist[key].yes++;
    else signalDist[key].no++;
  }

  // Market maker accounting
  const totalCashCollected = trades.reduce((sum, t) => sum + t.spend, 0);
  const totalYesShares = Array.from(players.values()).reduce(
    (sum, p) => sum + p.yesShares,
    0
  );
  const totalNoShares = Array.from(players.values()).reduce(
    (sum, p) => sum + p.noShares,
    0
  );
  const mmPLIfYes = totalCashCollected - totalYesShares;
  const mmPLIfNo = totalCashCollected - totalNoShares;

  // Round leaderboard
  const roundLeaderboard = Array.from(players.values())
    .map((p) => ({
      name: p.name,
      signalLabel: p.signalLabel,
      signal: p.signal,
      cash: Math.round(p.cash * 100) / 100,
      yesShares: p.yesShares,
      noShares: p.noShares,
      finalValue: p.finalValue != null ? Math.round(p.finalValue * 100) / 100 : null,
      roundProfit: p.roundProfit != null ? Math.round(p.roundProfit * 100) / 100 : null,
      portfolioValue: Math.round(
        (p.cash + p.yesShares * currentPrice + p.noShares * (1 - currentPrice)) * 100
      ) / 100,
    }))
    .sort((a, b) => {
      if (a.roundProfit != null && b.roundProfit != null)
        return b.roundProfit - a.roundProfit;
      return b.portfolioValue - a.portfolioValue;
    });

  // Cumulative leaderboard
  const cumulativeLeaderboard = Array.from(cumulativeStandings.values())
    .sort((a, b) => b.cumulativeProfit - a.cumulativeProfit)
    .map((s) => ({
      name: s.displayName,
      cumulativeProfit: Math.round(s.cumulativeProfit * 100) / 100,
      roundsScored: s.roundsScored,
      lastRoundProfit: Math.round(s.lastRoundProfit * 100) / 100,
    }));

  return {
    round: {
      ...currentRound,
      currentPrice: Math.round(currentPrice * 1000) / 1000,
    },
    scenario,
    hiddenOutcome: currentRound.hiddenOutcome,
    currentPrice: Math.round(currentPrice * 1000) / 1000,
    bayesianBenchmark:
      Math.round(computeBayesianBenchmark() * 1000) / 1000,
    studentOnlyPrice: Math.round(computeStudentOnlyPrice() * 1000) / 1000,
    playerCount: players.size,
    tradeCount: currentRound.tradeCount,
    remainingSeconds,
    signalDistribution: Object.values(signalDist),
    signalStructure: describeSignalStructure(scenario),
    priceHistory,
    trades: trades.map((t) => ({
      ...t,
      spend: Math.round(t.spend * 100) / 100,
      shares: Math.round(t.shares * 1000) / 1000,
      priceBefore: Math.round(t.priceBefore * 1000) / 1000,
      priceAfter: Math.round(t.priceAfter * 1000) / 1000,
      playerName: t.playerId ? players.get(t.playerId)?.name : "House",
    })),
    manipulationTrades: manipulationTrades.map((t) => ({
      ...t,
      spend: Math.round(t.spend * 100) / 100,
      shares: Math.round(t.shares * 1000) / 1000,
      priceBefore: Math.round(t.priceBefore * 1000) / 1000,
      priceAfter: Math.round(t.priceAfter * 1000) / 1000,
    })),
    manipulation: {
      budget: currentRound.manipulationBudget || 0,
      spent: Math.round((currentRound.manipulationSpent || 0) * 100) / 100,
      remaining:
        Math.round(
          ((currentRound.manipulationBudget || 0) -
            (currentRound.manipulationSpent || 0)) *
            100
        ) / 100,
    },
    marketMaker: {
      totalCashCollected: Math.round(totalCashCollected * 100) / 100,
      totalYesShares: Math.round(totalYesShares * 1000) / 1000,
      totalNoShares: Math.round(totalNoShares * 1000) / 1000,
      plIfYes: Math.round(mmPLIfYes * 100) / 100,
      plIfNo: Math.round(mmPLIfNo * 100) / 100,
      worstCaseLoss: Math.round(Math.min(mmPLIfYes, mmPLIfNo) * 100) / 100,
    },
    roundLeaderboard,
    cumulativeLeaderboard,
    showStudentLeaderboard,
  };
}

function getPublicRound() {
  if (!currentRound) return null;
  return {
    id: currentRound.id,
    scenarioId: currentRound.scenarioId,
    roundNumber: currentRound.roundNumber,
    mode: currentRound.mode,
    status: currentRound.status,
    showStudentPriceChart: currentRound.showStudentPriceChart,
  };
}

function getRound() {
  return currentRound;
}

function getPlayer(playerId) {
  return players.get(playerId) || null;
}

module.exports = {
  setBroadcast,
  newSession,
  toggleStudentLeaderboard,
  getShowStudentLeaderboard,
  resetRound,
  openTrading,
  pauseTrading,
  resumeTrading,
  resolveRound,
  addPlayer,
  executeTrade,
  executeManipulation,
  getStudentState,
  getInstructorState,
  getRound,
  getPlayer,
  computeBayesianBenchmark,
};
