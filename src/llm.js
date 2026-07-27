/*
 * llm.js — optional LLM-powered analysis of experiment results.
 *
 * The app is a static file:// page with no backend, so the only way to reach
 * Claude is a direct browser fetch to the Anthropic API using the user's own
 * key plus the `anthropic-dangerous-direct-browser-access` header. The key is
 * the user's secret: it lives only in localStorage (with a Clear button) and in
 * memory, is sent only to api.anthropic.com over HTTPS, and is never logged nor
 * placed in any error message. The whole feature is optional — everything else
 * in the app works offline without a key.
 *
 * This module owns: key/model persistence, the API call, and the prompt
 * builders that turn an experiment's parameters + full data into a request.
 */
(function (App) {
  'use strict';

  var API_URL = 'https://api.anthropic.com/v1/messages';
  var KEY_LS = 'epidemicLab.anthropicKey';
  var MODEL_LS = 'epidemicLab.model';
  var DEFAULT_MODEL = 'claude-opus-4-8';
  var MAX_TOKENS = 1500;
  var MAX_SERIES_POINTS = 300; // downsample longer time series to keep tokens sane

  // Model picker options (label → id). Opus is the default.
  var MODELS = [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (most capable)' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet (fast)' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku (fastest)' }
  ];

  var _key = null; // in-memory cache

  // ------------------------------------------------------- key / model store
  function ls() {
    try { return window.localStorage; } catch (e) { return null; }
  }
  function getKey() {
    if (_key != null) { return _key; }
    var s = ls();
    _key = (s && s.getItem(KEY_LS)) || '';
    return _key;
  }
  function setKey(k) {
    _key = k || '';
    var s = ls();
    if (s) { if (_key) { s.setItem(KEY_LS, _key); } else { s.removeItem(KEY_LS); } }
  }
  function clearKey() { setKey(''); }
  function hasKey() { return !!getKey(); }

  function getModel() {
    var s = ls();
    return (s && s.getItem(MODEL_LS)) || DEFAULT_MODEL;
  }
  function setModel(m) {
    var s = ls();
    if (s && m) { s.setItem(MODEL_LS, m); }
  }

  // --------------------------------------------------------------- API call
  function friendlyError(status) {
    if (status === 401) { return 'Your API key looks invalid (401). Check the key and try again.'; }
    if (status === 403) { return 'This key is not permitted to use the API (403).'; }
    if (status === 429) { return 'Rate limited by Anthropic (429). Wait a moment and try again.'; }
    if (status === 400) { return 'Anthropic rejected the request (400).'; }
    if (status >= 500) { return 'Anthropic had a server error (' + status + '). Try again shortly.'; }
    return 'Anthropic returned an error (' + status + ').';
  }

  // Send a {system, user} prompt to Claude and resolve with its text answer.
  function analyze(prompt) {
    var key = getKey();
    if (!key) { return Promise.reject(new Error('Add your Anthropic key to use analysis.')); }

    var body = {
      model: getModel(),
      max_tokens: MAX_TOKENS,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }]
    };

    return fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    }).catch(function () {
      // fetch only rejects on network/CORS failure (never on an HTTP error).
      throw new Error("Couldn't reach Anthropic — check your internet connection.");
    }).then(function (res) {
      if (!res.ok) { throw new Error(friendlyError(res.status)); }
      return res.json();
    }).then(function (data) {
      var blocks = (data && data.content) || [];
      var text = blocks
        .filter(function (b) { return b && b.type === 'text'; })
        .map(function (b) { return b.text; })
        .join('\n').trim();
      if (!text) { throw new Error('Anthropic returned an empty response.'); }
      return text;
    });
  }

  // ------------------------------------------------- data → prompt helpers
  var MODE_BLURB = {
    individuals: 'individuals — everyone moves independently around the map',
    households: 'households — people live in fixed family clusters that move together',
    communities: 'communities — people live in separate community cells and occasionally travel between them'
  };

  function round1(v) {
    return (Math.round(v * 10) / 10).toFixed(1);
  }
  function fmtP(p) {
    return p < 0.001 ? '<0.001' : p.toFixed(3);
  }
  function fmtVal(def, v) {
    // App.UI.fmt formats exactly as the on-screen panels do (units, decimals).
    return (App.UI && App.UI.fmt) ? App.UI.fmt(def, v) : String(v);
  }

  // The params in scope for a given population mode, mirroring ui.js's panel
  // filter, but INCLUDING the global params (population, initially infected,
  // max household size) so Claude sees the full configuration.
  function paramsInScope(paramsObj, mode) {
    var hh = mode === 'households';
    var comm = mode === 'communities';
    return App.PARAMS.filter(function (p) {
      if (p.requiresHouseholds && !hh) { return false; }
      if (p.requiresCommunities && !comm) { return false; }
      if (p.requiresQuarantine && !paramsObj.quarantineEnabled) { return false; }
      return true;
    });
  }

  // A bullet list of "Label: value — meaning" for every in-scope parameter.
  function describeParams(paramsObj, mode) {
    return paramsInScope(paramsObj, mode).map(function (def) {
      var val = fmtVal(def, paramsObj[def.key]);
      var desc = (def.help && def.help.desc) ? def.help.desc : '';
      return '- ' + def.label + ': ' + val + (desc ? ' — ' + desc : '');
    }).join('\n');
  }

  // Parameters whose value differs between two arms.
  function diffParams(control, test) {
    var out = [];
    App.PARAMS.forEach(function (def) {
      if (control[def.key] !== test[def.key]) {
        out.push({ def: def, control: control[def.key], test: test[def.key] });
      }
    });
    return out;
  }
  function diffText(control, test) {
    var d = diffParams(control, test);
    if (!d.length) { return 'The two arms have identical parameters.'; }
    return d.map(function (x) {
      return '- ' + x.def.label + ': control=' + fmtVal(x.def, x.control) +
        ' vs test=' + fmtVal(x.def, x.test);
    }).join('\n');
  }

  // Extract the full S/I/R time series + summary metrics from a live sim,
  // downsampling to ~MAX_SERIES_POINTS if the history is very long.
  function seriesFromSim(sim) {
    var h = (sim.history || []).slice();
    var initial = h.length ? h[0] : { t: 0, s: 0, i: 0, r: 0 };
    var final = sim.counts();
    var peakI = sim.peakInfected;
    var peakT = null;
    for (var i = 0; i < h.length; i++) {
      if (h[i].i === peakI) { peakT = h[i].t; break; }
    }

    var pts = h;
    var sampled = false;
    if (h.length > MAX_SERIES_POINTS) {
      sampled = true;
      pts = [];
      var stepN = (h.length - 1) / (MAX_SERIES_POINTS - 1);
      for (var k = 0; k < MAX_SERIES_POINTS; k++) {
        pts.push(h[Math.round(k * stepN)]);
      }
    }
    return {
      initial: initial, final: final, peakInfected: peakI, peakTime: peakT,
      total: final.total, sampled: sampled, points: pts
    };
  }

  function outcomeText(series) {
    var ini = series.initial, fin = series.final;
    return '- Starting: S ' + ini.s + ', I ' + ini.i + ', R ' + ini.r + '\n' +
      '- Peak infected: ' + series.peakInfected +
      (series.peakTime != null ? ' (at t≈' + round1(series.peakTime) + 's)' : '') + '\n' +
      '- Final: S ' + fin.s + ', I ' + fin.i + ', R ' + fin.r + ' (of ' + fin.total + ' total)';
  }

  function seriesTable(series) {
    var head = 't\tS\tI\tR' +
      (series.sampled ? '  (downsampled to ' + series.points.length + ' points)' : '');
    var rows = series.points.map(function (p) {
      return round1(p.t) + '\t' + p.s + '\t' + p.i + '\t' + p.r;
    });
    return head + '\n' + rows.join('\n');
  }

  // Shared persona + style for every analysis.
  var SYSTEM = [
    'You are an epidemiology teaching assistant embedded in an agent-based SIR epidemic',
    'simulator called Epidemic Lab. You explain experiment results to a curious non-expert.',
    'Be succinct and concrete: a few short bullets or brief paragraphs, plain language, no',
    'jargon (define any term you must use). Base every statement strictly on the data',
    'provided — never invent numbers. In this model, S = susceptible (never infected),',
    'I = currently infected, R = removed (recovered and now immune). A larger final R means',
    'more of the population caught the disease; a larger final S means more were spared.'
  ].join(' ');

  // ---- Single ----------------------------------------------------------
  function buildSingle(arm) {
    var mode = arm.params.populationMode;
    var series = seriesFromSim(arm.sim);
    var user = [
      'Experiment mode: Single run.',
      'Population structure: ' + (MODE_BLURB[mode] || mode) + '.',
      '',
      'Parameters (name: value — what it means):',
      describeParams(arm.params, mode),
      '',
      'Outcome:',
      outcomeText(series),
      '',
      'Full S/I/R time series (t in simulation-seconds):',
      seriesTable(series),
      '',
      'Please explain, succinctly and in simple terms:',
      '1) Why the infection peak happened when it did, and which parameters drove it.',
      '2) The outcome for the population — how many ended up removed (caught it and are now',
      '   immune) versus still susceptible (spared), and what that means.',
      'Keep it to a few short bullets.'
    ].join('\n');
    return { system: SYSTEM, user: user };
  }

  // ---- Compare ---------------------------------------------------------
  function buildCompare(control, test) {
    var mode = test.params.populationMode;
    var cs = seriesFromSim(control.sim);
    var ts = seriesFromSim(test.sim);
    var user = [
      'Experiment mode: Compare (Control vs Test/Treatment).',
      'Population structure: ' + (MODE_BLURB[mode] || mode) + '.',
      '',
      'Parameters that DIFFER between the arms:',
      diffText(control.params, test.params),
      '',
      '--- CONTROL arm ---',
      'Parameters (name: value — meaning):',
      describeParams(control.params, mode),
      'Outcome:',
      outcomeText(cs),
      'Time series (t\tS\tI\tR):',
      seriesTable(cs),
      '',
      '--- TEST (treatment) arm ---',
      'Parameters (name: value — meaning):',
      describeParams(test.params, mode),
      'Outcome:',
      outcomeText(ts),
      'Time series (t\tS\tI\tR):',
      seriesTable(ts),
      '',
      'Please assess, succinctly:',
      '1) Did the outcomes match what we would expect from the parameter differences? For',
      '   example, if the treatment adds quarantine, distancing, or hygiene, we would expect a',
      '   LOWER peak infected and MORE people left susceptible. State clearly whether the',
      '   treatment appears to work, does nothing, or produced a surprise.',
      '2) If there is no clear effect or a surprise, suggest what to change to get a',
      '   representative reading. You may suggest changing the population size and the',
      '   initially-infected count, as well as making the intervention stronger or the two',
      '   arms more different.',
      'Keep it to a few short bullets.'
    ].join('\n');
    return { system: SYSTEM, user: user };
  }

  // ---- Batch -----------------------------------------------------------
  function arr(a) { return '[' + a.join(', ') + ']'; }

  function metricLine(label, m) {
    // m = { control, test, stat:{p,...} } from Batch.summarize
    var delta = m.test - m.control;
    var sig = m.stat.p < 0.05;
    return label + ' — Control mean ' + round1(m.control) +
      ', Test mean ' + round1(m.test) +
      ', delta ' + (delta > 0 ? '+' : '') + round1(delta) +
      ', p=' + fmtP(m.stat.p) + ' (' + (sig ? 'significant' : 'NOT significant') + ')';
  }

  function buildBatch(batch) {
    // batch = { summary, raw, iterations, control(params), test(params) }
    var summary = batch.summary, raw = batch.raw;
    var modes = App.Batch.MODES;
    var control = batch.control, test = batch.test;

    var parts = [
      'Experiment mode: Batch (headless paired A/B test).',
      'N = ' + batch.iterations + ' paired iterations per population mode. In each iteration the',
      'Control and Test arms run from the SAME random seed (paired), so the per-iteration',
      'delta = Test − Control. A paired t-test over those deltas gives the p-value;',
      'a result is statistically significant at p < 0.05.',
      '',
      'Shared settings: population = ' + control.population +
        ', initially infected = ' + control.initialInfected + '.',
      '',
      'Parameters that DIFFER between the arms (same across all modes):',
      diffText(control, test),
      ''
    ];

    modes.forEach(function (mode) {
      var s = summary[mode], r = raw[mode];
      var label = mode.charAt(0).toUpperCase() + mode.slice(1);
      parts.push('=== ' + label + ' ===');
      parts.push(metricLine('Peak infected', s.peak));
      parts.push(metricLine('Total removed', s.removed));
      parts.push('Raw per-iteration data points:');
      parts.push('  Peak infected  — control: ' + arr(r.cPeak));
      parts.push('  Peak infected  — test:    ' + arr(r.tPeak));
      parts.push('  Total removed  — control: ' + arr(r.cRem));
      parts.push('  Total removed  — test:    ' + arr(r.tRem));
      parts.push('');
    });

    parts.push('Please analyse, succinctly and PER population mode:');
    parts.push('1) Say what happened — did the treatment reduce peak infected and/or total');
    parts.push('   removed, and is the change statistically significant?');
    parts.push('2) Acknowledge results that match expectations.');
    parts.push('3) Where a result is NOT as expected, or NOT statistically significant');
    parts.push('   (p ≥ 0.05), suggest what to change to get a statistically significant');
    parts.push('   reading — e.g. more iterations, a larger population, a different');
    parts.push('   initially-infected count, or a stronger intervention (a bigger difference');
    parts.push('   between the arms).');
    parts.push('Give a short verdict per mode plus concrete suggestions.');

    return { system: SYSTEM, user: parts.join('\n') };
  }

  App.LLM = {
    MODELS: MODELS,
    DEFAULT_MODEL: DEFAULT_MODEL,
    // key / model
    getKey: getKey, setKey: setKey, clearKey: clearKey, hasKey: hasKey,
    getModel: getModel, setModel: setModel,
    // API
    analyze: analyze,
    // prompt builders + helpers (exported for testing)
    describeParams: describeParams,
    diffText: diffText,
    seriesFromSim: seriesFromSim,
    buildSingle: buildSingle,
    buildCompare: buildCompare,
    buildBatch: buildBatch
  };
})(window.App = window.App || {});
