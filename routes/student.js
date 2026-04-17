const express = require("express");
const game = require("../lib/game");

const router = express.Router();

// Get current state for student
router.get("/api/state", (req, res) => {
  const playerId = req.cookies?.playerId;
  const state = game.getStudentState(playerId);
  res.json(state);
});

// Join the current round
router.post("/api/join", (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }

    const { player, playerId, existing } = game.addPlayer(name);

    // Set playerId cookie (httpOnly, lasts 24h)
    res.cookie("playerId", playerId, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: "lax",
    });

    const scenario = require("../config/scenarios").getScenario(
      game.getRound().scenarioId
    );

    const response = {
      playerId,
      name: player.name,
      signal: player.signal,
      signalLabel: player.signalLabel,
      cash: player.cash,
      existing,
    };

    if (scenario.signalDisplayMode === "exact") {
      response.posteriorYes =
        Math.round(player.posteriorYes * 1000) / 1000;
    } else {
      response.confidenceLabel = player.confidenceLabel;
    }

    res.json(response);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Execute a trade
router.post("/api/trade", (req, res) => {
  try {
    const playerId = req.cookies?.playerId;
    if (!playerId) {
      return res.status(400).json({ error: "Not joined. Please join first." });
    }

    const { spend, side } = req.body;
    if (!spend || spend <= 0) {
      return res.status(400).json({ error: "Spend must be positive" });
    }
    if (side !== "YES" && side !== "NO") {
      return res.status(400).json({ error: "Side must be YES or NO" });
    }

    const trade = game.executeTrade(playerId, side, Number(spend));

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
