const express = require("express");
const auth = require("../lib/auth");
const game = require("../lib/game");
const { SCENARIO_CONFIG, describeSignalStructure } = require("../config/scenarios");

const router = express.Router();

// Login
router.post("/api/instructor/login", (req, res) => {
  const { password } = req.body;
  const token = auth.login(password);
  if (!token) {
    return res.status(401).json({ error: "Invalid password" });
  }
  res.cookie("instructor_token", token, {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: "lax",
  });
  res.json({ success: true });
});

// All routes below require instructor auth
router.use(auth.requireInstructor);

// Get full instructor state
router.get("/api/instructor-state", (req, res) => {
  const state = game.getInstructorState();
  state.scenarios = SCENARIO_CONFIG.map((s) => ({
    id: s.id,
    title: s.title,
    teachingPoint: s.teachingPoint,
    manipulationEnabled: s.manipulationEnabled,
    manipulationBudget: s.manipulationBudget || (s.manipulationEnabled ? 600 : 0),
    signalDisplayMode: s.signalDisplayMode,
    durationSeconds: s.durationSeconds,
    mode: s.mode || "practice",
    signalStructure: describeSignalStructure(s),
  }));
  res.json(state);
});

// Start a completely new session: wipes cumulative standings, active round,
// players, trades. Use between two classroom sessions with different students.
router.post("/api/control/new-session", (req, res) => {
  try {
    const summary = game.newSession();
    res.json({ success: true, ...summary });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Toggle (or explicitly set) whether students can see the top-5 cumulative
// leaderboard. Instructor always sees the full leaderboard.
router.post("/api/control/toggle-leaderboard", (req, res) => {
  try {
    const { show } = req.body || {};
    const newValue = game.toggleStudentLeaderboard(
      typeof show === "boolean" ? show : undefined
    );
    res.json({ success: true, showStudentLeaderboard: newValue });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Reset round
router.post("/api/control/reset", (req, res) => {
  try {
    const { scenarioId, mode, manipulationBudget } = req.body;
    if (!scenarioId) {
      return res.status(400).json({ error: "scenarioId is required" });
    }
    const round = game.resetRound(scenarioId, mode, { manipulationBudget });
    res.json({ success: true, roundId: round.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Open trading
router.post("/api/control/open", (req, res) => {
  try {
    const { showStudentPriceChart, durationSeconds } = req.body;
    game.openTrading({ showStudentPriceChart, durationSeconds });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Pause trading
router.post("/api/control/pause", (req, res) => {
  try {
    game.pauseTrading();
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Resume trading
router.post("/api/control/resume", (req, res) => {
  try {
    game.resumeTrading();
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Resolve round
router.post("/api/control/resolve", (req, res) => {
  try {
    const result = game.resolveRound();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Manipulation trade
router.post("/api/control/manipulate", (req, res) => {
  try {
    const { spend, side } = req.body;
    if (!spend || spend <= 0) {
      return res.status(400).json({ error: "Spend must be positive" });
    }
    if (side !== "YES" && side !== "NO") {
      return res.status(400).json({ error: "Side must be YES or NO" });
    }
    const trade = game.executeManipulation(side, Number(spend));
    res.json({
      side: trade.side,
      spend: Math.round(trade.spend * 100) / 100,
      shares: Math.round(trade.shares * 1000) / 1000,
      priceBefore: Math.round(trade.priceBefore * 1000) / 1000,
      priceAfter: Math.round(trade.priceAfter * 1000) / 1000,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
