/*
 * batch.js — headless batch-experiment mode.
 *
 * Runs N paired iterations (Control vs Test, sharing a seed each iteration) for
 * each population mode, headlessly (no canvas), and reports the delta, p-value
 * and significance of the Test arm's effect on peak infected and total removed.
 */
(function (App) {
  'use strict';

  var MODES = ['individuals', 'households', 'communities'];
  var MODE_LABEL = { individuals: 'Individuals', households: 'Households', communities: 'Communities' };
  var BATCH_W = 360, BATCH_H = 360;
  var SIM_DT = 0.5;           // sim-seconds per headless step (substeps internally)
  var TIME_CAP = 400;         // hard stop (sim-seconds) if an epidemic never clears

  // Run one epidemic to completion and return its outcome metrics.
  function runHeadless(armParams, seed, mode) {
    var p = {};
    for (var k in armParams) { if (armParams.hasOwnProperty(k)) { p[k] = armParams[k]; } }
    p.populationMode = mode;
    var sim = new App.Simulation({ width: BATCH_W, height: BATCH_H, params: p, seed: seed });
    var guard = Math.ceil(TIME_CAP / SIM_DT);
    for (var s = 0; s < guard; s++) {
      sim.step(SIM_DT, 1);
      if (sim.counts().i === 0) { break; } // epidemic over
    }
    return { peak: sim.peakInfected, removed: sim.counts().r };
  }

  // Orchestrate the full batch asynchronously (chunked so the UI stays live).
  //   onProgress(done, total), onDone(results)
  function runBatch(controlParams, testParams, iterations, onProgress, onDone) {
    var N = Math.max(2, Math.round(iterations || 20));
    var total = MODES.length * N;
    var done = 0;

    // Fresh random base seed for THIS batch run, so re-running the experiment
    // produces a new set of randomized starting states (different dot layouts and
    // outcomes). Within a run, iteration i uses runBase+i, and Control/Test share
    // that seed each iteration (paired), while iterations differ from each other.
    var runBase = (Math.floor(Math.random() * 0x7fffffff) + 1) >>> 0;

    // Accumulators per mode.
    var acc = {};
    MODES.forEach(function (m) {
      acc[m] = { cPeak: [], tPeak: [], cRem: [], tRem: [], dPeak: [], dRem: [] };
    });

    // Flat task list: one (mode, iteration) per tick.
    var tasks = [];
    MODES.forEach(function (m) {
      for (var i = 0; i < N; i++) { tasks.push({ mode: m, iter: i }); }
    });

    var ti = 0;
    function tick() {
      var task = tasks[ti++];
      var seed = (runBase + task.iter) >>> 0; // shared seed → paired control/test
      var c = runHeadless(controlParams, seed, task.mode);
      var t = runHeadless(testParams, seed, task.mode);
      var a = acc[task.mode];
      a.cPeak.push(c.peak); a.tPeak.push(t.peak); a.dPeak.push(t.peak - c.peak);
      a.cRem.push(c.removed); a.tRem.push(t.removed); a.dRem.push(t.removed - c.removed);

      done++;
      if (onProgress) { onProgress(done, total); }

      if (ti < tasks.length) {
        setTimeout(tick, 0); // yield to the browser between runs
      } else {
        // Pass the summary (for the tables) AND the raw per-iteration accumulator
        // (every run's control/test peak & removed, per mode) so the optional LLM
        // analysis can send all data points, not just the aggregates.
        onDone(summarize(acc), acc);
      }
    }
    setTimeout(tick, 0);
  }

  function summarize(acc) {
    var out = {};
    MODES.forEach(function (m) {
      var a = acc[m];
      out[m] = {
        peak: {
          control: App.Stats.mean(a.cPeak), test: App.Stats.mean(a.tPeak),
          stat: App.Stats.pairedTTest(a.dPeak)
        },
        removed: {
          control: App.Stats.mean(a.cRem), test: App.Stats.mean(a.tRem),
          stat: App.Stats.pairedTTest(a.dRem)
        }
      };
    });
    return out;
  }

  // ---- Rendering --------------------------------------------------------
  function fmtNum(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function fmtP(p) { return p < 0.001 ? '<0.001' : p.toFixed(3); }

  function metricRow(label, m) {
    var s = m.stat;
    var sig = s.p < 0.05;
    var delta = m.test - m.control;
    var sign = delta > 0 ? '+' : '';
    return '<tr>' +
      '<td>' + label + '</td>' +
      '<td>' + fmtNum(m.control) + '</td>' +
      '<td>' + fmtNum(m.test) + '</td>' +
      '<td>' + sign + fmtNum(delta) + '</td>' +
      '<td>' + fmtP(s.p) + '</td>' +
      '<td class="' + (sig ? 'sig-yes' : 'sig-no') + '">' + (sig ? 'Yes' : 'No') + '</td>' +
      '</tr>';
  }

  function renderResults(container, results) {
    var html = '';
    MODES.forEach(function (m) {
      var r = results[m];
      html += '<div class="batch-table">' +
        '<h3>' + MODE_LABEL[m] + '</h3>' +
        '<table>' +
        '<thead><tr><th>Metric</th><th>Control</th><th>Test</th><th>Delta</th><th>p-value</th><th>Significant</th></tr></thead>' +
        '<tbody>' +
        metricRow('Peak infected', r.peak) +
        metricRow('Total removed', r.removed) +
        '</tbody></table></div>';
    });
    container.innerHTML = html;
  }

  App.Batch = {
    MODES: MODES,
    runHeadless: runHeadless,
    runBatch: runBatch,
    renderResults: renderResults
  };
})(window.App = window.App || {});
