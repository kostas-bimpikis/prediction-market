(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const loginOverlay = $("login-overlay");
  const loginForm = $("login-form");
  const loginPassword = $("login-password");
  const loginError = $("login-error");
  const banner = $("banner");
  const bannerStatus = $("banner-status");
  const bannerMode = $("banner-mode");
  const bannerTimer = $("banner-timer");
  const scenarioSelect = $("scenario-select");
  const scenarioTeaching = $("scenario-teaching");
  const btnReset = $("btn-reset");
  const btnOpen = $("btn-open");
  const btnPause = $("btn-pause");
  const btnResume = $("btn-resume");
  const btnResolve = $("btn-resolve");
  const chartToggle = $("chart-toggle");
  const manipPanel = $("manipulation-panel");
  const manipSide = $("manip-side");
  const manipSpend = $("manip-spend");
  const btnManipulate = $("btn-manipulate");
  const manipLogBody = $("manip-log-body");

  let chartManager = new PriceChartManager("instructor-chart");
  let state = null;
  let scenarios = [];
  let eventSource = null;
  let showChart = false;
  let authenticated = false;

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.classList.add("hidden");
    try {
      const res = await fetch("/api/instructor/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPassword.value }),
      });
      if (!res.ok) {
        loginError.textContent = "Invalid password";
        loginError.classList.remove("hidden");
        return;
      }
      authenticated = true;
      loginOverlay.classList.add("hidden");
      init();
    } catch (err) {
      loginError.textContent = "Connection error";
      loginError.classList.remove("hidden");
    }
  });

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------
  async function init() {
    await fetchState();
    connectSSE();
  }

  // -----------------------------------------------------------------------
  // Fetch state
  // -----------------------------------------------------------------------
  async function fetchState() {
    try {
      const res = await fetch("/api/instructor-state");
      if (res.status === 401) {
        loginOverlay.classList.remove("hidden");
        authenticated = false;
        return;
      }
      state = await res.json();

      // Populate scenarios dropdown once
      if (state.scenarios && scenarios.length === 0) {
        scenarios = state.scenarios;
        scenarioSelect.innerHTML = '<option value="">-- Select scenario --</option>';
        scenarios.forEach((s) => {
          const opt = document.createElement("option");
          opt.value = s.id;
          opt.textContent = `${s.id.toUpperCase()}: ${s.title}`;
          scenarioSelect.appendChild(opt);
        });
      }

      render();
    } catch (e) {
      console.error("Failed to fetch instructor state:", e);
    }
  }

  // -----------------------------------------------------------------------
  // SSE
  // -----------------------------------------------------------------------
  function connectSSE() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource("/api/instructor-events");

    eventSource.addEventListener("reset", () => {
      chartManager.destroy();
      fetchState();
    });

    eventSource.addEventListener("status-change", () => fetchState());
    eventSource.addEventListener("trade", () => fetchState());
    eventSource.addEventListener("player-joined", () => fetchState());
    eventSource.addEventListener("resolved", () => fetchState());
    eventSource.addEventListener("leaderboard-visibility", () => fetchState());

    eventSource.addEventListener("timer-tick", (e) => {
      const data = JSON.parse(e.data);
      if (state) state.remainingSeconds = data.remainingSeconds;
      renderTimer();
    });

    eventSource.onerror = () => {};
  }

  // -----------------------------------------------------------------------
  // Controls
  // -----------------------------------------------------------------------
  scenarioSelect.addEventListener("change", () => {
    const s = scenarios.find((sc) => sc.id === scenarioSelect.value);
    const budgetRow = document.getElementById("budget-input-row");
    const budgetInput = document.getElementById("manip-budget-input");
    const modeLabel = document.getElementById("mode-label");
    if (!s) {
      scenarioTeaching.textContent = "";
      budgetRow.classList.add("hidden");
      modeLabel.textContent = "--";
      modeLabel.style.color = "var(--gray-600)";
      return;
    }
    const display = s.signalDisplayMode === "coarse" ? "coarse (LOW/MED/HIGH)" : "exact posterior";
    scenarioTeaching.innerHTML =
      `<div style="margin-bottom:6px;">${s.teachingPoint}</div>` +
      `<div style="color:var(--gray-700);"><strong>Signals:</strong> ${s.signalStructure}</div>` +
      `<div style="color:var(--gray-500);font-size:.75rem;">Students see: ${display}${s.manipulationEnabled ? " · Manipulation enabled" : ""}</div>`;

    // Mode label (auto-determined from scenario)
    modeLabel.textContent = (s.mode || "practice").toUpperCase();
    modeLabel.style.color = s.mode === "scored" ? "var(--blue)" : "var(--gray-600)";

    // Show/hide manipulation budget input
    if (s.manipulationEnabled) {
      budgetRow.classList.remove("hidden");
      budgetRow.style.display = "flex";
      budgetInput.value = s.manipulationBudget || 600;
    } else {
      budgetRow.classList.add("hidden");
      budgetRow.style.display = "none";
    }
  });

  chartToggle.addEventListener("click", () => {
    showChart = !showChart;
    chartToggle.classList.toggle("active", showChart);
  });

  btnReset.addEventListener("click", async () => {
    const scenarioId = scenarioSelect.value;
    if (!scenarioId) return alert("Select a scenario first.");
    const budgetInput = document.getElementById("manip-budget-input");
    const body = { scenarioId };
    // Mode is now determined by the scenario config — not sent from client
    // Only include budget if the input is visible (manipulation-enabled scenario)
    const s = scenarios.find((sc) => sc.id === scenarioId);
    if (s && s.manipulationEnabled && budgetInput.value) {
      body.manipulationBudget = Number(budgetInput.value);
    }
    await apiCall("/api/control/reset", body);
  });

  btnOpen.addEventListener("click", async () => {
    await apiCall("/api/control/open", { showStudentPriceChart: showChart });
  });

  btnPause.addEventListener("click", async () => {
    await apiCall("/api/control/pause", {});
  });

  btnResume.addEventListener("click", async () => {
    await apiCall("/api/control/resume", {});
  });

  btnResolve.addEventListener("click", async () => {
    if (!confirm("Resolve this round and reveal the outcome?")) return;
    await apiCall("/api/control/resolve", {});
  });

  // Toggle leaderboard visibility for students
  const btnToggleLb = document.getElementById("btn-toggle-leaderboard");
  if (btnToggleLb) {
    btnToggleLb.addEventListener("click", async () => {
      await apiCall("/api/control/toggle-leaderboard", {});
    });
  }

  // New Session — two-step confirmation to prevent accidents
  const btnNewSession = document.getElementById("btn-new-session");
  if (btnNewSession) {
    btnNewSession.addEventListener("click", async () => {
      const ok1 = confirm(
        "Start a new session?\n\nThis will:\n" +
        "• Clear the cumulative leaderboard\n" +
        "• End any active round\n" +
        "• Remove all players\n\n" +
        "Use this only between two separate classes."
      );
      if (!ok1) return;

      const confirmText = prompt(
        'This cannot be undone. Type "NEW SESSION" to confirm.'
      );
      if (confirmText !== "NEW SESSION") {
        alert("New session cancelled.");
        return;
      }

      const result = await apiCall("/api/control/new-session", {});
      if (result) {
        alert(
          `New session started. Cleared ${result.standingsCleared} standing(s).`
        );
      }
    });
  }

  // Manipulation
  document.querySelectorAll(".manip-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      manipSpend.value = btn.dataset.amount;
    });
  });

  btnManipulate.addEventListener("click", async () => {
    const spend = Number(manipSpend.value);
    if (!spend || spend <= 0) return;
    await apiCall("/api/control/manipulate", {
      spend,
      side: manipSide.value,
    });
    manipSpend.value = "";
  });

  async function apiCall(url, body) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Request failed");
        return null;
      }
      await fetchState();
      return data;
    } catch (err) {
      alert("Network error");
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  function render() {
    if (!state) return;

    if (!state.round) {
      bannerStatus.textContent = "NO ROUND";
      bannerTimer.textContent = "";
      bannerMode.classList.add("hidden");
      banner.className = "banner closed";
      updateControls(null);
      return;
    }

    const round = state.round;
    const status = round.status;

    // Banner
    banner.className = "banner " + (status === "live" ? "live" : status === "paused" ? "paused" : status === "resolved" ? "resolved" : "closed");
    bannerStatus.textContent = status.toUpperCase();
    bannerMode.classList.remove("hidden");
    bannerMode.textContent = round.mode === "scored" ? "SCORED" : "PRACTICE";
    bannerMode.className = "badge " + (round.mode === "scored" ? "badge-scored" : "badge-practice");

    renderTimer();
    renderOverview();
    renderChart();
    renderMarketMaker();
    renderManipulation();
    renderLeaderboards();
    renderLeaderboardVisibility();
    updateControls(status);
  }

  function renderTimer() {
    if (!state) return;
    const secs = state.remainingSeconds || 0;
    const status = state.round?.status;
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

  function renderOverview() {
    const outcome = state.hiddenOutcome || "--";
    $("info-outcome").textContent = outcome;
    $("info-outcome").className = "value " + (outcome === "YES" ? "outcome-yes" : outcome === "NO" ? "outcome-no" : "");

    $("info-yes-price").textContent = state.currentPrice != null ? (state.currentPrice * 100).toFixed(1) + "%" : "--";
    $("info-no-price").textContent = state.currentPrice != null ? ((1 - state.currentPrice) * 100).toFixed(1) + "%" : "--";
    $("info-benchmark").textContent = state.bayesianBenchmark != null ? (state.bayesianBenchmark * 100).toFixed(1) + "%" : "--";
    $("info-student-only").textContent = state.studentOnlyPrice != null ? (state.studentOnlyPrice * 100).toFixed(1) + "%" : "--";
    // Highlight gap between actual price and student-only price (manipulation impact)
    if (state.scenario && state.scenario.manipulationEnabled && state.studentOnlyPrice != null && state.currentPrice != null) {
      const impact = Math.abs(state.currentPrice - state.studentOnlyPrice);
      $("info-student-only").style.color = impact > 0.05 ? "var(--green)" : "";
    } else {
      $("info-student-only").style.color = "";
    }
    $("info-players").textContent = state.playerCount || 0;
    $("info-trades").textContent = state.tradeCount || 0;

    // Signal structure description
    $("signal-structure").textContent = state.signalStructure || "--";

    // Signal distribution
    const dist = state.signalDistribution;
    if (dist && dist.length > 0) {
      const html = dist
        .map(
          (d) =>
            `<div style="margin-bottom:4px;"><strong>${d.label}</strong> (q=${d.accuracy}): <span style="color:var(--green)">${d.yes} YES</span> / <span style="color:var(--red)">${d.no} NO</span></div>`
        )
        .join("");
      $("signal-dist").innerHTML = html;
    } else {
      $("signal-dist").textContent = "No players yet";
    }
  }

  function renderChart() {
    if (!state || !state.priceHistory) return;

    const opts = {
      benchmark: state.bayesianBenchmark,
    };
    if (state.round?.status === "resolved") {
      opts.outcome = state.hiddenOutcome;
    }
    chartManager.init(state.priceHistory, opts);
  }

  function renderMarketMaker() {
    const mm = state.marketMaker;
    if (!mm) return;
    $("mm-cash").textContent = mm.totalCashCollected.toFixed(1);
    $("mm-yes").textContent = mm.totalYesShares.toFixed(2);
    $("mm-no").textContent = mm.totalNoShares.toFixed(2);
    $("mm-pl-yes").textContent = mm.plIfYes.toFixed(1);
    $("mm-pl-no").textContent = mm.plIfNo.toFixed(1);
    $("mm-worst").textContent = mm.worstCaseLoss.toFixed(1);
    $("mm-worst").style.color = mm.worstCaseLoss < 0 ? "var(--red)" : "inherit";
  }

  function renderManipulation() {
    if (!state.scenario || !state.scenario.manipulationEnabled) {
      manipPanel.classList.add("hidden");
      return;
    }
    manipPanel.classList.remove("hidden");

    // Default direction: wrong outcome
    const wrongSide = state.hiddenOutcome === "YES" ? "NO" : "YES";
    $("manipulation-hint").textContent = `True state is ${state.hiddenOutcome}. Recommended manipulation: Buy ${wrongSide} to push price away from truth.`;
    manipSide.value = wrongSide;

    // Budget display
    const m = state.manipulation || { budget: 0, spent: 0, remaining: 0 };
    $("manip-budget-total").textContent = m.budget.toFixed(0);
    $("manip-budget-spent").textContent = m.spent.toFixed(1);
    $("manip-budget-remaining").textContent = m.remaining.toFixed(1);
    const pct = m.budget > 0 ? m.spent / m.budget : 0;
    $("manipulation-budget-display").style.background =
      m.remaining <= 0 ? "rgba(220,38,38,.15)" :
      pct >= 0.75 ? "rgba(202,138,4,.15)" : "var(--gray-50)";

    // Disable execute button if budget exhausted
    if (m.remaining <= 0 && state.round?.status === "live") {
      btnManipulate.disabled = true;
      btnManipulate.textContent = "Budget Exhausted";
    } else {
      btnManipulate.textContent = "Execute";
    }

    // Log
    const mt = state.manipulationTrades || [];
    if (mt.length === 0) {
      manipLogBody.innerHTML = '<tr><td colspan="6" style="color:var(--gray-400)">No manipulation trades yet</td></tr>';
    } else {
      manipLogBody.innerHTML = mt
        .map(
          (t) => `<tr>
          <td>${new Date(t.createdAt).toLocaleTimeString()}</td>
          <td class="side-${t.side.toLowerCase()}">${t.side}</td>
          <td>${t.spend}</td>
          <td>${t.shares.toFixed(2)}</td>
          <td>${(t.priceBefore * 100).toFixed(1)}%</td>
          <td>${(t.priceAfter * 100).toFixed(1)}%</td>
        </tr>`
        )
        .join("");
    }
  }

  function renderLeaderboardVisibility() {
    const btn = document.getElementById("btn-toggle-leaderboard");
    const label = document.getElementById("lb-visibility-label");
    if (!btn || !label) return;
    const shown = !!state.showStudentLeaderboard;
    if (shown) {
      btn.textContent = "Hide from Students";
      btn.className = "btn btn-warn btn-sm";
      label.textContent = "Visible to students";
      label.style.color = "var(--green)";
    } else {
      btn.textContent = "Reveal to Students";
      btn.className = "btn btn-primary btn-sm";
      label.textContent = "Hidden from students";
      label.style.color = "var(--gray-500)";
    }
  }

  function renderLeaderboards() {
    // Round leaderboard
    const rl = state.roundLeaderboard || [];
    if (rl.length === 0) {
      $("round-lb-empty").classList.remove("hidden");
      $("round-lb-table").classList.add("hidden");
    } else {
      $("round-lb-empty").classList.add("hidden");
      $("round-lb-table").classList.remove("hidden");
      $("round-lb-body").innerHTML = rl
        .map(
          (p, i) => `<tr>
          <td>${i + 1}</td>
          <td>${p.name}</td>
          <td class="side-${p.signal.toLowerCase()}">${p.signal}</td>
          <td>${p.signalLabel}</td>
          <td>${p.roundProfit != null ? p.finalValue.toFixed(1) : p.portfolioValue.toFixed(1)}</td>
          <td style="color:${(p.roundProfit != null ? p.roundProfit : p.portfolioValue - 100) >= 0 ? 'var(--green)' : 'var(--red)'}">${p.roundProfit != null ? (p.roundProfit >= 0 ? '+' : '') + p.roundProfit.toFixed(1) : (p.portfolioValue - 100 >= 0 ? '+' : '') + (p.portfolioValue - 100).toFixed(1)}</td>
        </tr>`
        )
        .join("");
    }

    // Cumulative leaderboard
    const cl = state.cumulativeLeaderboard || [];
    if (cl.length === 0) {
      $("cum-lb-empty").classList.remove("hidden");
      $("cum-lb-table").classList.add("hidden");
    } else {
      $("cum-lb-empty").classList.add("hidden");
      $("cum-lb-table").classList.remove("hidden");
      $("cum-lb-body").innerHTML = cl
        .map(
          (p, i) => `<tr>
          <td>${i + 1}</td>
          <td>${p.name}</td>
          <td style="color:${p.cumulativeProfit >= 0 ? 'var(--green)' : 'var(--red)'}; font-weight:700">${p.cumulativeProfit >= 0 ? '+' : ''}${p.cumulativeProfit.toFixed(1)}</td>
          <td>${p.roundsScored}</td>
          <td style="color:${p.lastRoundProfit >= 0 ? 'var(--green)' : 'var(--red)'}">${p.lastRoundProfit >= 0 ? '+' : ''}${p.lastRoundProfit.toFixed(1)}</td>
        </tr>`
        )
        .join("");
    }
  }

  function updateControls(status) {
    if (!status) {
      btnOpen.disabled = true;
      btnPause.classList.add("hidden");
      btnResume.classList.add("hidden");
      btnResolve.disabled = true;
      return;
    }

    btnReset.disabled = false;

    switch (status) {
      case "closed":
        btnOpen.disabled = false;
        btnOpen.classList.remove("hidden");
        btnPause.classList.add("hidden");
        btnResume.classList.add("hidden");
        btnResolve.disabled = true;
        break;
      case "live":
        btnOpen.disabled = true;
        btnOpen.classList.add("hidden");
        btnPause.classList.remove("hidden");
        btnPause.disabled = false;
        btnResume.classList.add("hidden");
        btnResolve.disabled = false;
        break;
      case "paused":
        btnOpen.classList.add("hidden");
        btnPause.classList.add("hidden");
        btnResume.classList.remove("hidden");
        btnResume.disabled = false;
        btnResolve.disabled = false;
        break;
      case "resolved":
        btnOpen.disabled = true;
        btnOpen.classList.remove("hidden");
        btnPause.classList.add("hidden");
        btnResume.classList.add("hidden");
        btnResolve.disabled = true;
        break;
    }

    // Manipulation button — disabled if not live or budget exhausted
    const m = state?.manipulation;
    const budgetOk = !m || m.remaining > 0;
    btnManipulate.disabled = status !== "live" || !budgetOk;
  }

  // -----------------------------------------------------------------------
  // Check if already authenticated on page load
  // -----------------------------------------------------------------------
  (async function checkAuth() {
    try {
      const res = await fetch("/api/instructor-state");
      if (res.ok) {
        authenticated = true;
        loginOverlay.classList.add("hidden");
        state = await res.json();
        if (state.scenarios) {
          scenarios = state.scenarios;
          scenarioSelect.innerHTML = '<option value="">-- Select scenario --</option>';
          scenarios.forEach((s) => {
            const opt = document.createElement("option");
            opt.value = s.id;
            opt.textContent = `${s.id.toUpperCase()}: ${s.title}`;
            scenarioSelect.appendChild(opt);
          });
        }
        render();
        connectSSE();
      }
    } catch (e) {
      // Not authenticated, show login
    }
  })();
})();
