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
      help: 'Percentage of the population that practices social distancing: they steer to keep at least one infection radius away from everyone else.'
    },

    // ---- Public policy (scaffolded — more levers added in a later pass) ------
    {
      key: 'quarantineOnInfectionPct', label: 'Quarantine on infection', group: 'Public policy',
      min: 0, max: 100, step: 1, default: 0, unit: '%',
      help: 'Percentage of newly-infected people who immediately stop moving (quarantine), reducing onward spread.'
    },

    // ---- Simulation & environment -------------------------------------------
    {
      key: 'population', label: 'Population', group: 'Simulation & environment',
      min: 20, max: 500, step: 10, default: 200,
      help: 'Total number of people (dots) in the simulation.'
    },
    {
      key: 'initialInfected', label: 'Initially infected', group: 'Simulation & environment',
      min: 1, max: 50, step: 1, default: 3,
      help: 'How many people start out infected at time zero.'
    }
  ];

  // Build a plain {key: default} object — used to initialise an arm's params.
  function defaults() {
    var out = {};
    for (var i = 0; i < PARAMS.length; i++) {
      out[PARAMS[i].key] = PARAMS[i].default;
    }
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

  App.PARAMS = PARAMS;
  App.PARAM_GROUPS = GROUPS;
  App.paramDefaults = defaults;
  App.paramsByGroup = byGroup;
})(window.App = window.App || {});
