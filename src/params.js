/*
 * params.js — the single source of truth for all tunable per-arm parameters.
 *
 * Both the parameter UI (ui.js) and the simulation engine (simulation.js) read
 * from this schema. To add a new parameter later (e.g. infection probability,
 * mortality rate, a new public-policy lever) you add ONE entry here and it shows
 * up in the panel automatically and is available to the simulation.
 *
 * Field reference:
 *   key       unique identifier, used as the property name on a params object
 *   label     human-readable name shown in the UI
 *   group     subheading the control appears under (see GROUPS below)
 *   min/max   slider bounds
 *   step      slider granularity
 *   default   initial value
 *   unit      optional suffix shown next to the value (e.g. "%", "s", "px")
 *   temporal  true if the value is measured in simulation-seconds (documentation
 *             only — the time multiplier scales the whole clock, so temporal
 *             params scale automatically; see app.js/simulation.js)
 *   scope     'global' → controlled once in the top bar, shared by both arms
 *   requiresHouseholds  true → only shown when population mode is "Households"
 *   requiresQuarantine  true → only shown when that arm's quarantine is enabled
 *   type      'toggle' → boolean checkbox instead of a slider (min/max/step omitted)
 *   help      optional tooltip text
 */
(function (App) {
  'use strict';

  // Order here defines the order of subheadings in each arm's panel.
  var GROUPS = [
    'Disease parameters',
    'Personal control',
    'Public policy',
    'Simulation & environment'
  ];

  var PARAMS = [
    // ---- Disease parameters -------------------------------------------------
    {
      key: 'infectionRadius', label: 'Infection radius', group: 'Disease parameters',
      min: 5, max: 60, step: 1, default: 20, unit: 'px',
      help: 'How close a susceptible person must be to an infected person to risk infection. Drawn as the ring around each dot.'
    },
    {
      key: 'contactDurationToInfect', label: 'Contact time to infect', group: 'Disease parameters',
      min: 0, max: 10, step: 0.1, default: 1.5, unit: 's', temporal: true,
      help: 'Continuous time a susceptible person must spend within the infection radius of an infected person before catching the disease (resets if they move apart). Scaled by the global time multiplier.'
    },
    {
      key: 'infectiousDuration', label: 'Infectious duration', group: 'Disease parameters',
      min: 1, max: 60, step: 1, default: 14, unit: 's', temporal: true,
      help: 'How long a person stays infected (and contagious) before moving to Removed. Scaled by the global time multiplier.'
    },

    // ---- Personal control ---------------------------------------------------
    {
      key: 'socialDistancingPct', label: 'Social distancing', group: 'Personal control',
      min: 0, max: 100, step: 1, default: 0, unit: '%',
      help: 'Individuals mode: % of people who keep at least one infection radius from everyone else. Households mode: % of households that keep their whole family away from other households — and whose members also distance while they are out.'
    },
    {
      key: 'hygienePct', label: 'Hygiene & prevention', group: 'Personal control',
      min: 0, max: 100, step: 1, default: 0, unit: '%',
      help: 'Good hygiene / preventive practices (handwashing, masks, etc.). The percentage chance that a sustained close contact does NOT lead to infection — higher values reduce transmission and slow the spread.'
    },
    {
      key: 'quarantineCompliancePct', label: 'Quarantine compliance', group: 'Personal control',
      min: 0, max: 100, step: 1, default: 70, unit: '%', requiresQuarantine: true,
      help: 'Percentage of infected people who actually self-isolate (move into the quarantine zone) once quarantine is active. Only applies when quarantine is enabled.'
    },
    {
      key: 'quarantineDelay', label: 'Quarantine delay', group: 'Personal control',
      min: 0, max: 10, step: 0.5, default: 2, unit: 's', temporal: true, requiresQuarantine: true,
      help: 'How long after getting infected a person waits before moving into the quarantine zone. Scaled by the global time multiplier. Only applies when quarantine is enabled.'
    },

    // ---- Public policy ------------------------------------------------------
    {
      key: 'quarantineEnabled', label: 'Enable quarantine', group: 'Public policy',
      type: 'toggle', default: false,
      help: 'Turn on a quarantine zone: compliant infected people are moved into an isolated corner of the map. Reveals the quarantine knobs.'
    },
    {
      key: 'quarantineTriggerPct', label: 'Activation threshold', group: 'Public policy',
      min: 0, max: 50, step: 1, default: 5, unit: '%', requiresQuarantine: true,
      help: 'Government-mandated quarantine only kicks in once this % of the population has ever been infected (infected + removed).'
    },

    // ---- Simulation & environment (GLOBAL — shared by both arms) -------------
    {
      key: 'population', label: 'Population', group: 'Simulation & environment',
      min: 20, max: 500, step: 10, default: 200, scope: 'global',
      help: 'Total number of people (dots) in the simulation. Shared by both arms.'
    },
    {
      key: 'initialInfected', label: 'Initially infected', group: 'Simulation & environment',
      min: 1, max: 50, step: 1, default: 7, scope: 'global',
      help: 'How many people start out infected at time zero (defaults to ~3.5% of the population and re-derives when you change the population; still adjustable). Shared by both arms.'
    },
    {
      key: 'maxHouseholdSize', label: 'Max household size', group: 'Simulation & environment',
      min: 1, max: 8, step: 1, default: 4, scope: 'global', requiresHouseholds: true,
      help: 'In Households mode, people are split into groups of a random size between 1 and this value. Shared by both arms.'
    }
  ];

  // Build a plain {key: default} object — used to initialise an arm's params.
  function defaults() {
    var out = {};
    for (var i = 0; i < PARAMS.length; i++) {
      out[PARAMS[i].key] = PARAMS[i].default;
    }
    // Population mode is app-level (a mode selector, not a slider), but each arm
    // carries it so the simulation can read it from this.params.
    out.populationMode = 'individuals'; // 'individuals' | 'households'
    return out;
  }

  // Group the schema entries by their subheading, preserving GROUPS order.
  function byGroup() {
    var map = {};
    GROUPS.forEach(function (g) { map[g] = []; });
    PARAMS.forEach(function (p) {
      if (!map[p.key]) { /* noop */ }
      if (!map[p.group]) { map[p.group] = []; }
      map[p.group].push(p);
    });
    return GROUPS.map(function (g) { return { group: g, params: map[g] }; });
  }

  // Params flagged scope:'global' are controlled once in the top bar and shared
  // by both arms (e.g. population, initially infected).
  function globalParamDefs() {
    return PARAMS.filter(function (p) { return p.scope === 'global'; });
  }

  App.PARAMS = PARAMS;
  App.PARAM_GROUPS = GROUPS;
  App.paramDefaults = defaults;
  App.paramsByGroup = byGroup;
  App.globalParamDefs = globalParamDefs;
})(window.App = window.App || {});
