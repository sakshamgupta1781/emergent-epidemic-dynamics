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
  var populationMode = 'individuals'; // 'individuals' | 'households'
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

      var panelCtrl = App.UI.buildPanel(panelEl, params, makePanelCb(name),
        { householdMode: populationMode === 'households' });

      arms[name] = {
        name: name,
        params: params,
        canvas: canvas,
        ctx: canvas.getContext('2d'),
        chart: chart,
        sim: sim,
        panel: panelCtrl,
        panelEl: panelEl,
        countsEl: document.querySelector('[data-counts="' + name + '"]'),
        peakEl: document.querySelector('[data-peak="' + name + '"]')
      };
    });

    wireGlobalControls();
    buildGlobalParams();
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

  // Build the global (shared) simulation controls into the top bar from the
  // schema. Changing one applies to BOTH arms and restarts them comparably.
  function buildGlobalParams() {
    var container = document.getElementById('globalParams');
    container.innerHTML = '';
    var hh = populationMode === 'households';
    var controls = {}; // key -> {input, val, def} so controls can update each other

    App.globalParamDefs().filter(function (def) {
      return !def.requiresHouseholds || hh;
    }).forEach(function (def) {
      var label = document.createElement('label');
      label.className = 'ctl';
      if (def.help) { label.title = def.help; }

      var span = document.createElement('span');
      span.className = 'ctl-label';
      var val = document.createElement('b');
      val.textContent = App.UI.fmt(def, arms.test.params[def.key]);
      span.appendChild(document.createTextNode(def.label + ' '));
      span.appendChild(val);

      var input = document.createElement('input');
      input.type = 'range';
      input.min = def.min; input.max = def.max; input.step = def.step;
      input.value = arms.test.params[def.key];

      input.addEventListener('input', function () {
        var v = parseFloat(input.value);
        val.textContent = App.UI.fmt(def, v);
        arms.control.params[def.key] = v;
        arms.test.params[def.key] = v;
        // Keep initially-infected at ~3.5% of the population as it scales.
        if (def.key === 'population') { deriveInitialInfected(v, controls); }
        resizeCanvases();
        resetAll();
      });

      label.appendChild(span);
      label.appendChild(input);
      container.appendChild(label);
      controls[def.key] = { input: input, val: val, def: def };
    });
  }

  var INITIAL_INFECTED_FRACTION = 0.035;

  // Set both arms' initialInfected to ~3.5% of population and sync its slider.
  function deriveInitialInfected(population, controls) {
    var c = controls.initialInfected;
    if (!c) { return; }
    var d = c.def;
    var v = Math.max(d.min, Math.min(d.max, Math.round(population * INITIAL_INFECTED_FRACTION)));
    arms.control.params.initialInfected = v;
    arms.test.params.initialInfected = v;
    c.input.value = v;
    c.val.textContent = App.UI.fmt(d, v);
  }

  // --------------------------------------------------- param change routing
  function makePanelCb(name) {
    return function (key) { onParamChange(name, key); };
  }

  // Rebuild both arms' panels (e.g. when population mode toggles conditional
  // params on/off), preserving current values.
  function rebuildPanels() {
    ['control', 'test'].forEach(function (name) {
      var a = arms[name];
      a.panel = App.UI.buildPanel(a.panelEl, a.params, makePanelCb(name),
        { householdMode: populationMode === 'households' });
    });
    updateDiff();
  }

  function onParamChange(name, key) {
    var a = arms[name];
    if (key === 'socialDistancingPct') {
      a.sim.refreshBehavior();
    }
    // Other params are read live each step; structural/global params are handled
    // by their own controls.
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

    var popMode = document.getElementById('populationMode');
    popMode.value = populationMode;
    popMode.addEventListener('change', function () {
      populationMode = this.value;
      arms.control.params.populationMode = populationMode;
      arms.test.params.populationMode = populationMode;
      buildGlobalParams();  // show/hide max household size
      rebuildPanels();      // show/hide the two outing knobs
      resizeCanvases();
      resetAll();
    });

    var balance = document.getElementById('balanceArms');
    balance.addEventListener('click', balanceArms);
    balance.disabled = viewMode === 'single';

    var single = document.getElementById('viewSingle');
    var compare = document.getElementById('viewCompare');
    single.addEventListener('click', function () { setView('single', single, compare); });
    compare.addEventListener('click', function () { setView('compare', single, compare); });
  }

  // Copy the Control arm's per-arm parameters onto the Test arm so both arms are
  // identical, then restart both from the same state. Global params (population,
  // initially infected) are already shared, so only per-arm params are copied.
  function balanceArms() {
    App.PARAMS.forEach(function (def) {
      if (def.scope === 'global') { return; }
      arms.test.params[def.key] = arms.control.params[def.key];
    });
    arms.test.panel.refresh();
    arms.test.sim.refreshBehavior();
    resizeCanvases();
    resetAll();
    updateDiff();
  }

  function setView(mode, singleBtn, compareBtn) {
    if (mode === viewMode) { return; }
    viewMode = mode;
    singleBtn.classList.toggle('active', mode === 'single');
    compareBtn.classList.toggle('active', mode === 'compare');
    document.getElementById('arms').classList.toggle('single-view', mode === 'single');
    document.getElementById('balanceArms').disabled = mode === 'single';

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
      a.sim.render(a.ctx, ts);
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
