(function () {
  "use strict";

  // DOM refs
  const $ = (id) => document.getElementById(id);
  const banner = $("banner");
  const bannerStatus = $("banner-status");
  const bannerMode = $("banner-mode");
  const bannerTimer = $("banner-timer");
  const noRound = $("no-round");
  const eventHeader = $("event-header");
  const joinPanel = $("join-panel");
  const joinForm = $("join-form");
  const joinName = $("join-name");
  const joinError = $("join-error");
  const playerPanel = $("player-panel");
  const signalCard = $("signal-card");
  const signalDirection = $("signal-direction");
  const signalLabel = $("signal-label");
  const signalPosterior = $("signal-posterior");
  const signalConfidence = $("signal-confidence");
  const playerCash = $("player-cash");
  const playerPortfolio = $("player-portfolio");
  const playerYes = $("player-yes");
  const playerNo = $("player-no");
  const cumulativeRow = $("cumulative-row");
  const cumulativePl = $("cumulative-pl");
  const cumulativeRounds = $("cumulative-rounds");
  const tradePanel = $("trade-panel");
  const tradeSpend = $("trade-spend");
  const btnBuyYes = $("btn-buy-yes");
  const btnBuyNo = $("btn-buy-no");
  const tradeError = $("trade-error");
  const statPlayers = $("stat-players");
  const statTrades = $("stat-trades");
  const tradeHistory = $("trade-history");
  const tradesBody = $("trades-body");
  const chartCard = $("chart-card");
  const resolutionCard = $("resolution-card");
  const currentPriceEl = $("current-price");

  let chartManager = new PriceChartManager("price-chart");
  let currentState = null;
  let joined = false;
  let eventSource = null;

  // -----------------------------------------------------------------------
  // Fetch state
  // -----------------------------------------------------------------------
  async function fetchState() {
    try {
      const res = await fetch("/api/state");
      const state = await res.json();
      currentState = state;
      render(state);
    } catch (e) {
      console.error("Failed to fetch state:", e);
    }
  }

  // -----------------------------------------------------------------------
  // SSE
  // -----------------------------------------------------------------------
  function connectSSE() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource("/api/events");

    eventSource.addEventListener("reset", () => {
      joined = false;
      chartManager.destroy();
      fetchState();
    });

    eventSource.addEventListener("status-change", (e) => {
      const data = JSON.parse(e.data);
      if (currentState && currentState.round) {
        currentState.round.status = data.status;
        if (data.showStudentPriceChart !== undefined) {
          currentState.round.showStudentPriceChart = data.showStudentPriceChart;
        }
      }
      if (data.remainingSeconds !== undefined) {
        currentState.remainingSeconds = data.remainingSeconds;
      }
      render(currentState);
    });

    eventSource.addEventListener("trade", (e) => {
      const data = JSON.parse(e.data);
      if (currentState) {
        currentState.currentPrice = data.price;
        currentState.tradeCount = data.tradeCount;
        currentState.playerCount = data.playerCount;
        // Update chart if visible
        if (chartManager.chart && currentState.round &&
            (currentState.round.showStudentPriceChart || currentState.round.status === "resolved")) {
          chartManager.addPoint(data.price);
        }
      }
      renderPrice();
      renderStats();
      // Refresh full state to get updated portfolio
      fetchState();
    });

    eventSource.addEventListener("player-joined", (e) => {
      const data = JSON.parse(e.data);
      if (currentState) {
        currentState.playerCount = data.playerCount;
      }
      renderStats();
    });

    eventSource.addEventListener("timer-tick", (e) => {
      const data = JSON.parse(e.data);
      if (currentState) {
        currentState.remainingSeconds = data.remainingSeconds;
      }
      renderTimer();
    });

    eventSource.addEventListener("leaderboard-visibility", () => {
      fetchState();
    });

    eventSource.addEventListener("resolved", (e) => {
      const data = JSON.parse(e.data);
      if (currentState) {
        if (currentState.round) currentState.round.status = "resolved";
        currentState.resolution = data;
        currentState.priceHistory = data.priceHistory;
      }
      fetchState(); // Full refresh for final values
    });

    eventSource.onerror = () => {
      // SSE will auto-reconnect
    };
  }

  // -----------------------------------------------------------------------
  // Join
  // -----------------------------------------------------------------------
  joinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = joinName.value.trim();
    if (!name) return;

    joinError.classList.add("hidden");
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        joinError.textContent = data.error;
        joinError.classList.remove("hidden");
        return;
      }
      joined = true;
      fetchState();
    } catch (err) {
      joinError.textContent = "Failed to join. Please try again.";
      joinError.classList.remove("hidden");
    }
  });

  // -----------------------------------------------------------------------
  // Trading
  // -----------------------------------------------------------------------
  btnBuyYes.addEventListener("click", () => executeTrade("YES"));
  btnBuyNo.addEventListener("click", () => executeTrade("NO"));

  tradeSpend.addEventListener("input", () => {
    const spend = Number(tradeSpend.value);
    const canTrade = currentState?.round?.status === "live" && joined && spend > 0;
    btnBuyYes.disabled = !canTrade;
    btnBuyNo.disabled = !canTrade;
  });

  async function executeTrade(side) {
    const spend = Number(tradeSpend.value);
    if (!spend || spend <= 0) return;

    tradeError.classList.add("hidden");
    btnBuyYes.disabled = true;
    btnBuyNo.disabled = true;

    try {
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spend, side }),
      });
      const data = await res.json();
      if (!res.ok) {
        tradeError.textContent = data.error;
        tradeError.classList.remove("hidden");
        btnBuyYes.disabled = false;
        btnBuyNo.disabled = false;
        return;
      }
      tradeSpend.value = "";
      fetchState();
    } catch (err) {
      tradeError.textContent = "Trade failed. Please try again.";
      tradeError.classList.remove("hidden");
      btnBuyYes.disabled = false;
      btnBuyNo.disabled = false;
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  function render(state) {
    // Page container — widens when round is resolved so chart + top-5
    // can sit side-by-side on desktops.
    const containerEl = document.querySelector(".container");

    if (!state || !state.round) {
      noRound.classList.remove("hidden");
      eventHeader.classList.add("hidden");
      joinPanel.classList.add("hidden");
      playerPanel.classList.add("hidden");
      bannerStatus.textContent = "WAITING";
      bannerTimer.textContent = "";
      bannerMode.classList.add("hidden");
      banner.className = "banner closed";
      if (containerEl) containerEl.classList.remove("resolved-wide");
      return;
    }

    // Toggle wide layout post-resolution
    if (containerEl) {
      if (state.round.status === "resolved") {
        containerEl.classList.add("resolved-wide");
      } else {
        containerEl.classList.remove("resolved-wide");
      }
    }

    noRound.classList.add("hidden");
    eventHeader.classList.remove("hidden");

    // Event header
    if (state.scenario) {
      $("event-title").textContent = state.scenario.title;
      $("event-question").textContent = state.scenario.question;
      $("event-description").textContent = state.scenario.description;
    }

    renderPrice();
    renderBanner(state);
    renderStats();
    renderTimer();

    // Joined state
    if (state.player) {
      joined = true;
      joinPanel.classList.add("hidden");
      playerPanel.classList.remove("hidden");
      renderPlayer(state);
      renderTradingControls(state);
      renderTradeHistory(state);
      renderChart(state);
      renderResolution(state);
      renderTop5(state);
    } else {
      // Not joined - show join panel if round exists and not resolved
      if (state.round.status !== "resolved") {
        joinPanel.classList.remove("hidden");
        playerPanel.classList.add("hidden");
      } else {
        joinPanel.classList.add("hidden");
        playerPanel.classList.add("hidden");
      }
    }
  }

  function renderBanner(state) {
    const status = state.round.status;
    banner.className = "banner " + (status === "live" ? "live" : status === "paused" ? "paused" : status === "resolved" ? "resolved" : "closed");

    if (status === "live") bannerStatus.textContent = "LIVE";
    else if (status === "paused") bannerStatus.textContent = "PAUSED";
    else if (status === "resolved") bannerStatus.textContent = "RESOLVED";
    else bannerStatus.textContent = "CLOSED";

    // Mode badge
    const mode = state.round.mode;
    bannerMode.classList.remove("hidden");
    bannerMode.textContent = mode === "scored" ? "SCORED" : "PRACTICE";
    bannerMode.className = "badge " + (mode === "scored" ? "badge-scored" : "badge-practice");
  }

  function renderTimer() {
    if (!currentState) return;
    const secs = currentState.remainingSeconds || 0;
    const status = currentState.round?.status;
    if (status === "live" || status === "paused" || status === "closed") {
      const abs = Math.abs(secs);
      const m = Math.floor(abs / 60);
      const s = abs % 60;
      const formatted = `${m}:${String(s).padStart(2, "0")}`;
      if (secs < 0) {
        bannerTimer.textContent = `+${formatted}`;
        bannerTimer.style.color = "#fef9c3";
      } else {
        bannerTimer.textContent = formatted;
        bannerTimer.style.color = "";
      }
    } else {
      bannerTimer.textContent = "";
      bannerTimer.style.color = "";
    }
  }

  function renderPrice() {
    if (!currentState) return;
    const p = currentState.currentPrice;
    currentPriceEl.textContent = (p * 100).toFixed(1) + "%";
  }

  function renderStats() {
    if (!currentState) return;
    statPlayers.textContent = currentState.playerCount || 0;
    statTrades.textContent = currentState.tradeCount || 0;
  }

  function renderPlayer(state) {
    const p = state.player;
    if (!p) return;

    // Signal
    signalCard.className = "card signal-card signal-" + p.signal.toLowerCase();
    signalDirection.textContent = "Signal: " + p.signal;
    signalLabel.textContent = "Source: " + p.signalLabel;

    if (state.scenario.signalDisplayMode === "exact" && p.posteriorYes != null) {
      signalPosterior.textContent = `Your private estimate: ${(p.posteriorYes * 100).toFixed(0)}% chance of YES`;
      signalPosterior.classList.remove("hidden");
      signalConfidence.classList.add("hidden");
    } else if (p.confidenceLabel) {
      signalConfidence.innerHTML = `Confidence: <span class="confidence-badge confidence-${p.confidenceLabel}">${p.confidenceLabel}</span>`;
      signalConfidence.classList.remove("hidden");
      signalPosterior.classList.add("hidden");
    }

    // Portfolio
    playerCash.textContent = p.cash.toFixed(2);
    playerPortfolio.textContent = p.portfolioValue.toFixed(2);
    playerYes.textContent = p.yesShares ? p.yesShares.toFixed(2) : "0";
    playerNo.textContent = p.noShares ? p.noShares.toFixed(2) : "0";

    // Cumulative
    if (state.cumulative) {
      cumulativeRow.classList.remove("hidden");
      const pl = state.cumulative.cumulativeProfit;
      cumulativePl.textContent = (pl >= 0 ? "+" : "") + pl.toFixed(2);
      cumulativePl.className = pl >= 0 ? "positive" : "negative";
      cumulativeRounds.textContent = state.cumulative.roundsScored;
    }

    // Resolution player data
    if (state.round.status === "resolved" && p.roundProfit != null) {
      playerPortfolio.textContent = p.finalValue.toFixed(2);
    }
  }

  function renderTradingControls(state) {
    const isLive = state.round.status === "live";
    if (isLive) {
      tradePanel.classList.remove("hidden");
      const spend = Number(tradeSpend.value);
      const canTrade = spend > 0;
      btnBuyYes.disabled = !canTrade;
      btnBuyNo.disabled = !canTrade;
    } else {
      tradePanel.classList.add("hidden");
    }
  }

  function renderTradeHistory(state) {
    if (!state.playerTrades || state.playerTrades.length === 0) {
      tradeHistory.classList.add("hidden");
      return;
    }
    tradeHistory.classList.remove("hidden");
    tradesBody.innerHTML = state.playerTrades
      .map(
        (t) => `<tr>
        <td class="side-${t.side.toLowerCase()}">${t.side}</td>
        <td>${t.spend.toFixed(1)}</td>
        <td>${t.shares.toFixed(2)}</td>
        <td>${(t.priceAfter * 100).toFixed(1)}%</td>
      </tr>`
      )
      .join("");
  }

  function renderChart(state) {
    const show =
      state.round.status === "resolved" ||
      (state.round.showStudentPriceChart && state.round.status !== "closed" && state.round.status !== "resolved");

    // Always show after resolution
    if (state.round.status === "resolved" && state.priceHistory) {
      chartCard.classList.remove("hidden");
      const opts = {};
      if (state.resolution) {
        opts.benchmark = state.resolution.bayesianBenchmark;
        opts.outcome = state.resolution.outcome;
      }
      chartManager.init(state.priceHistory, opts);
      return;
    }

    if (show && state.priceHistory) {
      chartCard.classList.remove("hidden");
      if (!chartManager.chart) {
        chartManager.init(state.priceHistory);
      }
    } else {
      chartCard.classList.add("hidden");
    }
  }

  function renderTop5(state) {
    const card = $("top5-card");
    const body = $("top5-body");
    const top = state.topStandings || [];
    if (top.length === 0) {
      card.classList.add("hidden");
      return;
    }
    card.classList.remove("hidden");
    const myName = state.player?.name?.toLowerCase();
    body.innerHTML = top
      .map((p, i) => {
        const isMe = myName && p.name.toLowerCase() === myName;
        const plColor = p.cumulativeProfit >= 0 ? "var(--green)" : "var(--red)";
        const sign = p.cumulativeProfit >= 0 ? "+" : "";
        return `<tr${isMe ? ' style="background:var(--yellow-bg);font-weight:600;"' : ""}>
          <td>${i + 1}</td>
          <td>${p.name}${isMe ? " (you)" : ""}</td>
          <td style="color:${plColor};font-weight:600;">${sign}${p.cumulativeProfit.toFixed(2)}</td>
          <td>${p.roundsScored}</td>
        </tr>`;
      })
      .join("");
  }

  function renderAggregation(r) {
    const grid = $("aggregation-grid");
    const note = $("aggregation-note");
    const truthPx = r.outcome === "YES" ? 1 : 0;
    const truthLabel = r.outcome === "YES" ? "100% (YES)" : "0% (NO)";

    // Build the info-grid items. For rounds without manipulation we do NOT
    // show the "students-only price" box (it would hint that something
    // other than student trades can move the price). The manipulator's
    // existence is revealed only in the manipulation round.
    const items = [
      {
        label: "Bayesian benchmark",
        value: (r.bayesianBenchmark * 100).toFixed(1) + "%",
        sub: "if all signals were pooled",
        color: "var(--blue)",
      },
    ];

    if (r.manipulationEnabled) {
      items.push({
        label: "Students-only price",
        value: (r.studentOnlyPrice * 100).toFixed(1) + "%",
        sub: "from student trades alone",
        color: "var(--green)",
      });
    }

    items.push({
      label: "Actual market price",
      value: (r.finalPrice * 100).toFixed(1) + "%",
      sub: "what the market settled at",
      color: "var(--gray-700)",
    });
    items.push({
      label: "True outcome",
      value: truthLabel,
      sub: "the realized state",
      color: r.outcome === "YES" ? "var(--green)" : "var(--red)",
    });

    grid.innerHTML = items
      .map(
        (it) => `<div style="background:var(--gray-50);padding:8px 10px;border-radius:6px;">
        <div style="font-size:.7rem;color:var(--gray-500);text-transform:uppercase;letter-spacing:.03em;">${it.label}</div>
        <div style="font-size:1.1rem;font-weight:700;color:${it.color};">${it.value}</div>
        <div style="font-size:.7rem;color:var(--gray-500);">${it.sub}</div>
      </div>`
      )
      .join("");

    if (r.manipulationEnabled) {
      const impactPp = (r.manipulationImpact * 100).toFixed(1);
      const sign = r.manipulationImpact >= 0 ? "+" : "";
      const studentDist = Math.abs(r.studentOnlyPrice - truthPx) * 100;
      const actualDist = Math.abs(r.finalPrice - truthPx) * 100;
      const helped = actualDist < studentDist;
      note.innerHTML =
        `<strong>Surprise — this round had a hidden manipulator.</strong> ` +
        `They spent ${r.manipulationSpent.toFixed(0)} credits to push the price ${
          r.manipulationImpact >= 0 ? "up toward YES" : "down toward NO"
        } (impact: ${sign}${impactPp} pp). ` +
        `Without manipulation, the market would have settled at ${(
          r.studentOnlyPrice * 100
        ).toFixed(1)}%. ` +
        (helped
          ? `Ironically the manipulation moved the price closer to truth this time.`
          : `Students aggregated to ${(
              r.studentOnlyPrice * 100
            ).toFixed(1)}% (distance from truth: ${studentDist.toFixed(
              1
            )}pp), but manipulation pushed the visible price to ${(
              r.finalPrice * 100
            ).toFixed(1)}% (distance: ${actualDist.toFixed(1)}pp).`);
      note.style.display = "";
    } else {
      // Hide the interpretive note entirely in non-manipulation rounds so
      // students are not tipped off that manipulation is a possibility.
      note.textContent = "";
      note.style.display = "none";
    }
  }

  function renderResolution(state) {
    if (state.round.status !== "resolved" || !state.resolution) {
      resolutionCard.classList.add("hidden");
      return;
    }
    resolutionCard.classList.remove("hidden");

    const r = state.resolution;
    const outcome = r.outcome;
    $("resolution-outcome").textContent = `Outcome: ${outcome}`;
    $("resolution-outcome").style.color = outcome === "YES" ? "var(--green)" : "var(--red)";

    $("resolution-signal-structure").innerHTML = r.signalStructure
      ? `<strong>Signal structure:</strong> ${r.signalStructure}`
      : "";

    // Information aggregation panel
    renderAggregation(r);

    $("res-price").textContent = (r.finalPrice * 100).toFixed(1) + "%";
    $("res-benchmark").textContent = (r.bayesianBenchmark * 100).toFixed(1) + "%";
    $("res-trades").textContent = r.totalTrades;
    $("res-yes-spend").textContent = r.totalYesSpend.toFixed(1);
    $("res-no-spend").textContent = r.totalNoSpend.toFixed(1);

    if (state.player) {
      const pl = state.player.roundProfit || 0;
      $("res-pl").textContent = (pl >= 0 ? "+" : "") + pl.toFixed(2);
      $("res-pl").style.color = pl >= 0 ? "var(--green)" : "var(--red)";
      $("res-final").textContent = (state.player.finalValue || 0).toFixed(2);
    }

    if (state.cumulative) {
      const cpl = state.cumulative.cumulativeProfit;
      $("res-cumulative").textContent = (cpl >= 0 ? "+" : "") + cpl.toFixed(2);
      $("res-cumulative").style.color = cpl >= 0 ? "var(--green)" : "var(--red)";
    } else {
      $("res-cumulative").textContent = "N/A";
    }
  }

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------
  fetchState();
  connectSSE();
})();
