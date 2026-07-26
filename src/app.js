/*
 * app.js — bootstraps the two arms, wires the global controls, and runs the
 * single animation loop that drives BOTH arms off one shared clock.
 */
(function (App) {
  'use strict';

  var BASE_SEED = 1337;

  // Global run state.
  var running = false;
  var viewMode = 'single';           // 'single' | 'compare'
  var sharedSeed = true;
  var dotSpeed = 1;
  var timeMult = 1;
  var lastTs = 0;

  // Per-arm bundles, keyed by 'control' / 'test'.
  var arms = {};

  // ------------------------------------------------------------------ setup
  function boot() {
    ['control', 'test'].forEach(function (name) {
      var params = App.paramDefaults();
      var canvas = document.querySelector('[data-sim="' + name + '"]');
      var chartCanvas = document.querySelector('[data-chart="' + name + '"]');
      var panelEl = document.querySelector('[data-panel="' + name + '"]');

      var sim = new App.Simulation({
        width: 300, height: 300, // real size set by resizeCanvases()
        params: params,
        seed: name === 'control' ? BASE_SEED : (sharedSeed ? BASE_SEED : BASE_SEED + 1)
      });

      var chart = new App.SIRChart(chartCanvas);

      var panelCtrl = App.UI.buildPanel(panelEl, params, function (key) {
        onParamChange(name, key);
      });

      arms[name] = {
        name: name,
        params: params,
        canvas: canvas,
        ctx: canvas.getContext('2d'),
        chart: chart,
        sim: sim,
        panel: panelCtrl,
        countsEl: document.querySelector('[data-counts="' + name + '"]'),
        peakEl: document.querySelector('[data-peak="' + name + '"]')
      };
    });

    wireGlobalControls();
    resizeCanvases();
    resetAll();
    updateDiff();

    window.addEventListener('resize', debounce(function () {
      resizeCanvases();
      resetAll();
    }, 200));

    requestAnimationFrame(loop);
  }

  function activeArms() {
    return viewMode === 'single' ? ['test'] : ['control', 'test'];
  }

  // ------------------------------------------------------- canvas sizing
  function resizeCanvases() {
    var dpr = window.devicePixelRatio || 1;
    activeArms().forEach(function (name) {
      var a = arms[name];
      var rect = a.canvas.getBoundingClientRect();
      var w = Math.max(50, Math.floor(rect.width));
      var h = Math.max(50, Math.floor(rect.height));
      a.canvas.width = Math.floor(w * dpr);
      a.canvas.height = Math.floor(h * dpr);
      a.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      a.sim.width = w;
      a.sim.height = h;
    });
  }

  // ------------------------------------------------------- reset / seeds
  function seedFor(name) {
    if (name === 'control') { return BASE_SEED; }
    return sharedSeed ? BASE_SEED : BASE_SEED + 1;
  }

  function resetAll() {
    activeArms().forEach(function (name) {
      var a = arms[name];
      a.sim.reset(seedFor(name));
      a.chart.reset();
      updateReadout(a);
    });
  }

  // --------------------------------------------------- param change routing
  function onParamChange(name, key) {
    var a = arms[name];
    if (key === 'population' || key === 'initialInfected') {
      // Structural change → rebuild both arms so they restart comparably.
      resetAll();
    } else if (key === 'socialDistancingPct' || key === 'quarantineOnInfectionPct') {
      a.sim.refreshBehavior();
    }
    // Disease params (radius, contact, infectious duration) are read live each
    // step, so no extra work needed.
    updateDiff();
  }

  function updateDiff() {
    App.UI.applyDiff(
      arms.test.panel,
      arms.control.params,
      arms.test.params,
      viewMode === 'compare'
    );
  }

  // ------------------------------------------------------- global controls
  function wireGlobalControls() {
    var playBtn = document.getElementById('playPause');
    playBtn.addEventListener('click', function () {
      running = !running;
      playBtn.textContent = running ? '⏸ Pause' : '▶ Play';
      playBtn.classList.toggle('btn-primary', !running);
    });

    document.getElementById('reset').addEventListener('click', function () {
      resizeCanvases();
      resetAll();
    });

    var ds = document.getElementById('dotSpeed');
    var dsVal = document.getElementById('dotSpeedVal');
    ds.addEventListener('input', function () {
      dotSpeed = parseFloat(ds.value);
      dsVal.textContent = dotSpeed.toFixed(1) + '×';
    });

    var tm = document.getElementById('timeMult');
    var tmVal = document.getElementById('timeMultVal');
    tm.addEventListener('input', function () {
      timeMult = parseFloat(tm.value);
      tmVal.textContent = timeMult.toFixed(2) + '×';
    });

    document.getElementById('sharedSeed').addEventListener('change', function () {
      sharedSeed = this.checked;
      resetAll();
    });

    var single = document.getElementById('viewSingle');
    var compare = document.getElementById('viewCompare');
    single.addEventListener('click', function () { setView('single', single, compare); });
    compare.addEventListener('click', function () { setView('compare', single, compare); });
  }

  function setView(mode, singleBtn, compareBtn) {
    if (mode === viewMode) { return; }
    viewMode = mode;
    singleBtn.classList.toggle('active', mode === 'single');
    compareBtn.classList.toggle('active', mode === 'compare');
    document.getElementById('arms').classList.toggle('single-view', mode === 'single');

    // Let layout settle, then measure + restart both arms from t=0 together.
    requestAnimationFrame(function () {
      resizeCanvases();
      resetAll();
      updateDiff();
    });
  }

  // ------------------------------------------------------------- main loop
  function loop(ts) {
    if (!lastTs) { lastTs = ts; }
    var realDt = Math.min((ts - lastTs) / 1000, 0.05); // clamp big gaps
    lastTs = ts;

    // Time multiplier accelerates the whole clock; clamp per-frame sim time so
    // the substep count stays bounded at extreme multipliers.
    var simDt = Math.min(realDt * timeMult, 0.25);

    activeArms().forEach(function (name) {
      var a = arms[name];
      if (running) { a.sim.step(simDt, dotSpeed); }
      a.sim.render(a.ctx);
      a.chart.sync(a.sim.history, ts, !running, a.sim.peakInfected);
      updateReadout(a);
    });

    requestAnimationFrame(loop);
  }

  function updateReadout(a) {
    var c = a.sim.counts();
    a.countsEl.innerHTML =
      'S <b>' + c.s + '</b> · I <b>' + c.i + '</b> · R <b>' + c.r + '</b>';
    a.peakEl.textContent = 'Peak I: ' + a.sim.peakInfected;
  }

  // --------------------------------------------------------------- helpers
  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  // Kick things off once the DOM + Chart.js are ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.App = window.App || {});
