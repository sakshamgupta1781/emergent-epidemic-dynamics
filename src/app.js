/*
 * app.js — bootstraps the two arms, wires the global controls, and runs the
 * single animation loop that drives BOTH arms off one shared clock.
 */
(function (App) {
  'use strict';

  var BASE_SEED = 1337;

  // Global run state.
  var running = false;
  var viewMode = 'single';           // 'single' | 'compare' | 'batch'
  var populationMode = 'individuals'; // 'individuals' | 'households' | 'communities'
  var sharedSeed = true;
  var armsLinked = false;            // link toggle: sync Control & Test params
  var dotSpeed = 1;
  var timeMult = 1;
  var lastTs = 0;

  // Snapshot of the most recent batch run (summary + raw per-iteration data +
  // the exact params used), for the optional LLM analysis. Null until a run.
  var lastBatch = null;

  var DEFAULT_AI_HINT =
    'Optional. Your key is stored locally in this browser and sent only to Anthropic.';

  // Per-arm bundles, keyed by 'control' / 'test'.
  var arms = {};

  function cloneParams(p) {
    var o = {};
    for (var k in p) { if (p.hasOwnProperty(k)) { o[k] = p[k]; } }
    return o;
  }

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

      var panelCtrl = App.UI.buildPanel(panelEl, params, makePanelCb(name), panelOpts());

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
    updateAnalyzeEnabled();

    window.addEventListener('resize', debounce(function () {
      resizeCanvases();
      resetAll();
    }, 200));

    requestAnimationFrame(loop);
  }

  function activeArms() {
    if (viewMode === 'batch') { return []; } // no live sims in batch mode
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

  // Visibility flags for conditional per-arm params, from the current mode.
  // Batch mode shows only the controls common to every population mode.
  function panelOpts() {
    if (viewMode === 'batch') { return { householdMode: false, communitiesMode: false }; }
    return {
      householdMode: populationMode === 'households',
      communitiesMode: populationMode === 'communities'
    };
  }

  // Rebuild both arms' panels (e.g. when population mode toggles conditional
  // params on/off), preserving current values.
  function rebuildPanels() {
    ['control', 'test'].forEach(function (name) {
      var a = arms[name];
      a.panel = App.UI.buildPanel(a.panelEl, a.params, makePanelCb(name), panelOpts());
    });
    updateDiff();
  }

  function onParamChange(name, key) {
    var a = arms[name];
    var isToggle = key === 'quarantineEnabled';

    // When linked, mirror the change to the other arm.
    if (armsLinked) {
      var other = arms[name === 'control' ? 'test' : 'control'];
      other.params[key] = a.params[key];
      other.sim.refreshBehavior();
      if (!isToggle) { other.panel.refresh(); }
    }

    if (isToggle) {
      // Show/hide the quarantine knobs (both arms) and update behavior live.
      rebuildPanels();
      a.sim.refreshBehavior();
      return; // rebuildPanels already refreshed diff highlighting
    }
    if (key === 'socialDistancingPct' || key === 'quarantineCompliancePct') {
      a.sim.refreshBehavior();
    }
    // Other params (disease, quarantine delay/threshold) are read live each
    // step; structural/global params are handled by their own controls.
    updateDiff();
  }

  function updateDiff() {
    App.UI.applyDiff(
      arms.test.panel,
      arms.control.params,
      arms.test.params,
      viewMode === 'compare' || viewMode === 'batch'
    );
  }

  // ------------------------------------------------------- global controls
  function wireGlobalControls() {
    var playBtn = document.getElementById('playPause');
    playBtn.addEventListener('click', function () {
      running = !running;
      playBtn.textContent = running ? '⏸ Pause' : '▶ Play';
      playBtn.classList.toggle('btn-play', !running);  // green when it will start
      playBtn.classList.toggle('btn-pause', running);  // gray while running
      updateAnalyzeEnabled();  // analysis needs a paused, fixed snapshot
    });

    document.getElementById('reset').addEventListener('click', function () {
      resizeCanvases();
      resetAll();
    });

    var tm = document.getElementById('timeMult');
    var tmVal = document.getElementById('timeMultVal');
    tm.addEventListener('input', function () {
      timeMult = parseFloat(tm.value);
      tmVal.textContent = timeMult.toFixed(2) + '×';
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

    document.getElementById('armLink').addEventListener('click', function () {
      setArmsLinked(!armsLinked);
    });

    document.getElementById('viewSingle').addEventListener('click', function () { setView('single'); });
    document.getElementById('viewCompare').addEventListener('click', function () { setView('compare'); });
    document.getElementById('viewBatch').addEventListener('click', function () { setView('batch'); });

    wireBatchControls();
    wireAnalysis();
  }

  // -------------------------------------------------- LLM analysis (optional)
  function wireAnalysis() {
    // Populate the model picker from App.LLM and reflect the stored choice.
    var sel = document.getElementById('analyzeModel');
    App.LLM.MODELS.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.id; o.textContent = m.label;
      sel.appendChild(o);
    });
    sel.value = App.LLM.getModel();
    sel.addEventListener('change', function () { App.LLM.setModel(sel.value); });

    var keyInput = document.getElementById('apiKey');
    var hint = document.getElementById('aiHint');
    keyInput.value = App.LLM.getKey();
    keyInput.addEventListener('input', function () {
      App.LLM.setKey(keyInput.value.trim());
      hint.textContent = DEFAULT_AI_HINT;
      hint.classList.remove('warn');
    });

    document.getElementById('clearKey').addEventListener('click', function () {
      App.LLM.clearKey();
      keyInput.value = '';
      keyInput.focus();
    });

    document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);
    document.getElementById('analysisClose').addEventListener('click', closeModal);
    document.querySelector('#analysisModal .modal-backdrop')
      .addEventListener('click', closeModal);

    // Key-entry dialog.
    document.getElementById('keySave').addEventListener('click', saveKeyFromModal);
    document.getElementById('keyClose').addEventListener('click', closeKeyModal);
    document.querySelector('#keyModal .modal-backdrop')
      .addEventListener('click', closeKeyModal);
    document.getElementById('keyModalInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { saveKeyFromModal(); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') { return; }
      if (!document.getElementById('keyModal').hidden) { closeKeyModal(); }
      else if (!document.getElementById('analysisModal').hidden) { closeModal(); }
    });
  }

  // Analysis needs a fixed reference point: enable Analyze only when the live
  // simulation is paused (single/compare). Batch results are already static.
  function updateAnalyzeEnabled() {
    var btn = document.getElementById('analyzeBtn');
    var enabled = (viewMode === 'batch') ? true : !running;
    btn.disabled = !enabled;
    btn.title = enabled ? '' : 'Pause the simulation to analyze a fixed snapshot.';
  }

  // Key-entry dialog: shown only when Analyze is clicked without a stored key.
  var pendingAnalysis = false; // run the analysis once a key is saved

  function openKeyModal() {
    var m = document.getElementById('keyModal');
    document.getElementById('keyModalError').hidden = true;
    var input = document.getElementById('keyModalInput');
    input.value = App.LLM.getKey();
    m.hidden = false;
    input.focus();
  }
  function closeKeyModal() {
    document.getElementById('keyModal').hidden = true;
    pendingAnalysis = false;
  }
  function saveKeyFromModal() {
    var input = document.getElementById('keyModalInput');
    var key = input.value.trim();
    var err = document.getElementById('keyModalError');
    if (!key) {
      err.hidden = false;
      err.textContent = 'Please enter your Anthropic API key.';
      input.focus();
      return;
    }
    App.LLM.setKey(key);
    // Keep the inline settings field in sync so Clear key still works.
    document.getElementById('apiKey').value = key;
    document.getElementById('keyModal').hidden = true;
    if (pendingAnalysis) { pendingAnalysis = false; runAnalysis(); }
  }

  function runAnalysis() {
    if (document.getElementById('analyzeBtn').disabled) { return; }
    if (!App.LLM.hasKey()) { pendingAnalysis = true; openKeyModal(); return; }

    var prompt, title;
    if (viewMode === 'single') {
      prompt = App.LLM.buildSingle(arms.test);
      title = 'Single-run analysis';
    } else if (viewMode === 'compare') {
      prompt = App.LLM.buildCompare(arms.control, arms.test);
      title = 'Control vs Treatment analysis';
    } else { // batch
      if (!lastBatch) {
        openModal('Batch analysis');
        showError('Run the experiment first, then click Analyze.');
        return;
      }
      prompt = App.LLM.buildBatch(lastBatch);
      title = 'Batch experiment analysis';
    }

    openModal(title);
    showSpinner();
    App.LLM.analyze(prompt).then(function (text) {
      showResult(text);
    }, function (err) {
      showError((err && err.message) ? err.message : 'Something went wrong.');
    });
  }

  // ---- analysis modal ---------------------------------------------------
  function openModal(title) {
    document.getElementById('analysisTitle').textContent = title;
    document.getElementById('analysisModal').hidden = false;
  }
  function closeModal() {
    document.getElementById('analysisModal').hidden = true;
  }
  function showSpinner() {
    document.getElementById('analysisSpinner').hidden = false;
    document.getElementById('analysisError').hidden = true;
    document.getElementById('analysisText').innerHTML = '';
  }
  function showError(msg) {
    document.getElementById('analysisSpinner').hidden = true;
    var e = document.getElementById('analysisError');
    e.hidden = false; e.textContent = msg;
    document.getElementById('analysisText').innerHTML = '';
  }
  function showResult(text) {
    document.getElementById('analysisSpinner').hidden = true;
    document.getElementById('analysisError').hidden = true;
    document.getElementById('analysisText').innerHTML = renderMarkish(text);
  }

  // Minimal, safe formatter for Claude's lightly-marked-up reply: HTML-escape,
  // then honor **bold**, "- " bullets, blank lines, and paragraphs.
  function renderMarkish(text) {
    var esc = String(text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    esc = esc.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    var lines = esc.split('\n');
    var html = '';
    var inList = false;
    lines.forEach(function (ln) {
      var m = /^\s*[-*•]\s+(.*)$/.exec(ln);
      if (m) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + m[1] + '</li>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (ln.trim() === '') { html += ''; }
        else { html += '<p>' + ln + '</p>'; }
      }
    });
    if (inList) { html += '</ul>'; }
    return html;
  }

  // Run the headless batch experiment and render the result tables.
  function wireBatchControls() {
    var btn = document.getElementById('runBatch');
    var prog = document.getElementById('batchProgress');
    btn.addEventListener('click', function () {
      var iters = parseInt(document.getElementById('batchIterations').value, 10) || 20;
      btn.disabled = true;
      lastBatch = null; // previous results are stale once a new run starts
      prog.textContent = 'Running… 0/' + (iters * App.Batch.MODES.length);
      App.Batch.runBatch(
        arms.control.params, arms.test.params, iters,
        function (done, total) { prog.textContent = 'Running… ' + done + '/' + total; },
        function (results, raw) {
          App.Batch.renderResults(document.getElementById('batchResults'), results);
          // Snapshot the summary, every run's raw data points, and the exact
          // params used, so "Analyze" can send Claude the full picture.
          lastBatch = {
            summary: results, raw: raw, iterations: iters,
            control: cloneParams(arms.control.params),
            test: cloneParams(arms.test.params)
          };
          prog.textContent = 'Done — ' + iters + ' iterations × ' + App.Batch.MODES.length + ' modes.';
          btn.disabled = false;
        }
      );
    });
  }

  // Link toggle: when turned ON, copy the Control arm's per-arm parameters onto
  // the Test arm and keep them live-synced (see onParamChange). When OFF, the
  // arms can be edited independently. Global params are already shared.
  function setArmsLinked(on) {
    armsLinked = on;
    var btn = document.getElementById('armLink');
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) {
      App.PARAMS.forEach(function (def) {
        if (def.scope === 'global') { return; }
        arms.test.params[def.key] = arms.control.params[def.key];
      });
      rebuildPanels();
      arms.test.sim.refreshBehavior();
      resizeCanvases();
      resetAll();
      updateDiff();
    }
  }

  function setView(mode) {
    if (mode === viewMode) { return; }
    viewMode = mode;
    document.getElementById('viewSingle').classList.toggle('active', mode === 'single');
    document.getElementById('viewCompare').classList.toggle('active', mode === 'compare');
    document.getElementById('viewBatch').classList.toggle('active', mode === 'batch');

    var armsEl = document.getElementById('arms');
    armsEl.classList.toggle('single-view', mode === 'single');
    armsEl.classList.toggle('batch-view', mode === 'batch');
    document.getElementById('batch').style.display = mode === 'batch' ? 'block' : 'none';

    // Visible params differ (batch shows common-only) → rebuild both panels.
    rebuildPanels();
    updateAnalyzeEnabled();

    // Let layout settle, then measure + restart the live arms (none in batch).
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
