/**
 * Chart.js wrapper for price chart with reference lines.
 */
class PriceChartManager {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.chart = null;
    this.data = [];
  }

  init(priceHistory, options = {}) {
    if (this.chart) this.chart.destroy();

    this.data = (priceHistory || []).map((p, i) => ({
      x: i,
      y: p.price,
    }));

    const annotations = {};

    // Prior line at 0.50
    annotations.priorLine = {
      type: "line",
      yMin: 0.5,
      yMax: 0.5,
      borderColor: "#9ca3af",
      borderWidth: 1,
      borderDash: [6, 4],
      label: {
        display: true,
        content: "Prior (50%)",
        position: "start",
        backgroundColor: "rgba(156,163,175,.8)",
        font: { size: 10 },
      },
    };

    // Bayesian benchmark
    if (options.benchmark != null) {
      annotations.benchmarkLine = {
        type: "line",
        yMin: options.benchmark,
        yMax: options.benchmark,
        borderColor: "#2563eb",
        borderWidth: 2,
        borderDash: [4, 4],
        label: {
          display: true,
          content: `Bayesian (${(options.benchmark * 100).toFixed(0)}%)`,
          position: "end",
          backgroundColor: "rgba(37,99,235,.8)",
          font: { size: 10 },
        },
      };
    }

    // True outcome line (after resolution)
    if (options.outcome != null) {
      const outcomeY = options.outcome === "YES" ? 1 : 0;
      annotations.outcomeLine = {
        type: "line",
        yMin: outcomeY,
        yMax: outcomeY,
        borderColor: outcomeY === 1 ? "#16a34a" : "#dc2626",
        borderWidth: 2,
        label: {
          display: true,
          content: `Outcome: ${options.outcome}`,
          position: "start",
          backgroundColor: outcomeY === 1 ? "rgba(22,163,74,.8)" : "rgba(220,38,38,.8)",
          font: { size: 10 },
        },
      };
    }

    this.chart = new Chart(this.canvas, {
      type: "line",
      data: {
        datasets: [
          {
            label: "YES Price",
            data: this.data,
            borderColor: "#2563eb",
            backgroundColor: "rgba(37,99,235,.1)",
            borderWidth: 2,
            pointRadius: this.data.length > 50 ? 0 : 3,
            pointHoverRadius: 5,
            fill: true,
            tension: 0.1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 200 },
        scales: {
          x: {
            type: "linear",
            display: true,
            title: { display: true, text: "Trade #", font: { size: 11 } },
            ticks: { stepSize: 1 },
          },
          y: {
            min: 0,
            max: 1,
            title: { display: true, text: "YES Price", font: { size: 11 } },
            ticks: {
              callback: (v) => (v * 100).toFixed(0) + "%",
            },
          },
        },
        plugins: {
          legend: { display: false },
          annotation: { annotations },
          tooltip: {
            callbacks: {
              label: (ctx) => `Price: ${(ctx.parsed.y * 100).toFixed(1)}%`,
            },
          },
        },
      },
    });
  }

  addPoint(price) {
    if (!this.chart) return;
    const idx = this.data.length;
    this.data.push({ x: idx, y: price });
    this.chart.data.datasets[0].data = this.data;
    // Reduce point size as data grows
    if (this.data.length > 50) {
      this.chart.data.datasets[0].pointRadius = 0;
    }
    this.chart.update("none");
  }

  updateBenchmark(benchmark) {
    if (!this.chart) return;
    const ann = this.chart.options.plugins.annotation.annotations;
    ann.benchmarkLine = {
      type: "line",
      yMin: benchmark,
      yMax: benchmark,
      borderColor: "#2563eb",
      borderWidth: 2,
      borderDash: [4, 4],
      label: {
        display: true,
        content: `Bayesian (${(benchmark * 100).toFixed(0)}%)`,
        position: "end",
        backgroundColor: "rgba(37,99,235,.8)",
        font: { size: 10 },
      },
    };
    this.chart.update("none");
  }

  destroy() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    this.data = [];
  }
}
