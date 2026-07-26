/*
 * charts.js — the SIR time-series chart for one arm, backed by Chart.js.
 *
 * Each series shows the TRUE CURRENT count of its compartment (not stacked):
 *   - Susceptible : starts at (population - initialInfected) and declines
 *   - Infected    : current infected — rises to a peak, then falls (the wave
 *                   that pressures medical infrastructure)
 *   - Removed     : current removed — rises and plateaus
 * A dashed reference line marks the peak infected value so the height of the
 * wave is easy to read. Updates are throttled to avoid redrawing every frame.
 */
(function (App) {
  'use strict';

  var COLORS = App.STATE_COLORS;
  var UPDATE_MS = 120; // min real-ms between chart redraws

  // Inline plugin: draw a dashed horizontal line at the peak-infected value.
  var peakLinePlugin = {
    id: 'peakLine',
    afterDatasetsDraw: function (chart) {
      var peak = chart.$peakInfected || 0;
      if (peak <= 0) { return; }
      var yScale = chart.scales.y;
      var area = chart.chartArea;
      if (!yScale || !area) { return; }
      var y = yScale.getPixelForValue(peak);
      if (y < area.top || y > area.bottom) { return; }
      var ctx = chart.ctx;
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = COLORS.I;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(area.left, y);
      ctx.lineTo(area.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.I;
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Peak infected: ' + peak, area.right - 4, y - 2);
      ctx.restore();
    }
  };

  function SIRChart(canvas) {
    this.lastUpdate = 0;

    this.chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          // Susceptible & Removed as clean lines; Infected filled to emphasise
          // the epidemic wave and its peak.
          dataset('Susceptible', COLORS.S, false),
          dataset('Infected', COLORS.I, true),
          dataset('Removed', COLORS.R, false)
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { intersect: false, mode: 'index' },
        elements: { point: { radius: 0 } },
        scales: {
          x: {
            title: { display: true, text: 'Time (sim-seconds)', color: '#8892a6' },
            ticks: { color: '#8892a6', maxTicksLimit: 8 },
            grid: { color: 'rgba(255,255,255,0.05)' }
          },
          y: {
            stacked: false,            // each line shows its own current count
            beginAtZero: true,
            title: { display: true, text: 'People (current count)', color: '#8892a6' },
            ticks: { color: '#8892a6', precision: 0 },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        },
        plugins: {
          legend: { labels: { color: '#c7cfdb', boxWidth: 12 } },
          tooltip: { enabled: true }
        }
      },
      plugins: [peakLinePlugin]
    });
  }

  function dataset(label, color, filled) {
    return {
      label: label,
      data: [],
      borderColor: color,
      backgroundColor: hexA(color, 0.18),
      borderWidth: 2,
      fill: filled ? 'origin' : false,
      tension: 0.25
    };
  }

  // Push the latest history into the chart. `force` bypasses the throttle
  // (used on reset / pause so the final state is always drawn).
  SIRChart.prototype.sync = function (history, nowMs, force, peakInfected) {
    if (!force && nowMs - this.lastUpdate < UPDATE_MS) { return; }
    this.lastUpdate = nowMs;
    this.chart.$peakInfected = peakInfected || 0;

    var labels = new Array(history.length);
    var s = new Array(history.length);
    var i = new Array(history.length);
    var r = new Array(history.length);
    for (var k = 0; k < history.length; k++) {
      labels[k] = history[k].t.toFixed(1);
      s[k] = history[k].s;
      i[k] = history[k].i;
      r[k] = history[k].r;
    }
    var d = this.chart.data;
    d.labels = labels;
    d.datasets[0].data = s;
    d.datasets[1].data = i;
    d.datasets[2].data = r;
    this.chart.update('none');
  };

  SIRChart.prototype.reset = function () {
    this.chart.$peakInfected = 0;
    var d = this.chart.data;
    d.labels = [];
    d.datasets[0].data = [];
    d.datasets[1].data = [];
    d.datasets[2].data = [];
    this.chart.update('none');
  };

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  App.SIRChart = SIRChart;
})(window.App = window.App || {});
