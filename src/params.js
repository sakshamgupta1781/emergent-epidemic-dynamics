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
 *   requiresCommunities true → only shown when population mode is "Communities"
 *   requiresQuarantine  true → only shown when that arm's quarantine is enabled
 *   type      'toggle' → boolean checkbox instead of a slider (min/max/step omitted)
 *   help      { desc, up, down } shown in the info-icon tooltip: what it means
 *             (with a real-world analogy), and the effect of increasing/decreasing
 *             it. `up`/`down` are omitted for toggles.
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
      help: {
        desc: 'How close you must be to an infected person to be at risk — a proxy for how communicable the disease is (e.g. a measles-like airborne bug reaches far; a contact-only bug reaches barely).',
        up: 'More contagious disease — it spreads faster and to more people.',
        down: 'Less contagious — slower, smaller outbreaks.'
      }
    },
    {
      key: 'contactDurationToInfect', label: 'Contact time to infect', group: 'Disease parameters',
      min: 0, max: 10, step: 0.1, default: 1, unit: 's', temporal: true,
      help: {
        desc: 'How long continuous close contact must last before the disease passes — reflects how big a "dose" of exposure it takes to catch it. Resets if people move apart.',
        up: 'Harder to catch — brief passing encounters are safe, so spread slows.',
        down: 'Catches almost instantly on contact — spread accelerates.'
      }
    },
    {
      key: 'infectiousDuration', label: 'Infectious duration', group: 'Disease parameters',
      min: 1, max: 60, step: 1, default: 14, unit: 's', temporal: true,
      help: {
        desc: 'How long a person stays contagious before recovering/being removed — the length of the infectious period of the illness.',
        up: 'Longer contagious window — each person infects more others, so the outbreak grows larger.',
        down: 'People stop spreading sooner — smaller outbreak.'
      }
    },

    // ---- Personal control ---------------------------------------------------
    {
      key: 'socialDistancingPct', label: 'Social distancing', group: 'Personal control',
      min: 0, max: 100, step: 1, default: 0, unit: '%',
      help: {
        desc: 'Share of people who keep their physical distance — staying out of others\' space, avoiding crowds. (In Households mode it\'s the share of households that keep their whole family away from others.)',
        up: 'More people keeping apart — fewer close contacts, so a flatter, smaller epidemic.',
        down: 'Normal mixing and crowding — faster, larger epidemic.'
      }
    },
    {
      key: 'hygienePct', label: 'Hygiene & prevention', group: 'Personal control',
      min: 0, max: 100, step: 1, default: 0, unit: '%',
      help: {
        desc: 'How well people take precautions that stop a close contact from actually transmitting — handwashing, masks, not hugging/kissing, covering coughs. It\'s the chance a would-be transmission is prevented.',
        up: 'Strong precautions — many close contacts fail to transmit, lowering the peak and slowing spread.',
        down: 'Poor hygiene — nearly every close contact can infect, so the disease races through.'
      }
    },
    {
      key: 'quarantineCompliancePct', label: 'Quarantine compliance', group: 'Personal control',
      min: 0, max: 100, step: 1, default: 70, unit: '%', requiresQuarantine: true,
      help: {
        desc: 'Of the people who get infected, the share who actually self-isolate (enter the quarantine ward) once quarantine is active — reflects public trust and willingness to comply.',
        up: 'More infectious people taken out of circulation — the outbreak is contained.',
        down: 'Infected people keep mixing — quarantine barely helps.'
      }
    },
    {
      key: 'quarantineDelay', label: 'Quarantine delay', group: 'Personal control',
      min: 0, max: 10, step: 0.5, default: 2, unit: 's', temporal: true, requiresQuarantine: true,
      help: {
        desc: 'How long after getting infected a person isolates — reflects testing speed, symptom onset, and how quickly people react.',
        up: 'Longer to isolate — more time to spread first, so quarantine is less effective.',
        down: 'People isolate almost immediately — very effective containment.'
      }
    },
    {
      key: 'tripDuration', label: 'Trip duration', group: 'Personal control',
      min: 0.5, max: 20, step: 0.5, default: 3, unit: 's', temporal: true, requiresCommunities: true,
      help: {
        desc: 'How long a traveller stays in another community before returning home — longer visits mean more mixing while away. (Communities mode only.)',
        up: 'Longer visits — more exposure in the visited community, more cross-spread.',
        down: 'Quick trips — less mixing, less cross-community spread.'
      }
    },

    // ---- Public policy ------------------------------------------------------
    {
      key: 'quarantineEnabled', label: 'Enable quarantine', group: 'Public policy',
      type: 'toggle', default: false,
      help: {
        desc: 'Turns on a government quarantine ward: once triggered, compliant infected people are moved into an isolated corner of the map where they can\'t spread. Reveals the quarantine knobs.'
      }
    },
    {
      key: 'quarantineTriggerPct', label: 'Activation threshold', group: 'Public policy',
      min: 0, max: 50, step: 1, default: 5, unit: '%', requiresQuarantine: true,
      help: {
        desc: 'How widespread the outbreak must get (% of the population ever infected) before government quarantine kicks in — reflects a proactive vs. reactive response.',
        up: 'Government waits longer to act — the outbreak is much larger before it\'s brought under control.',
        down: 'Early action — the outbreak is caught and contained sooner.'
      }
    },
    {
      key: 'interCommunityTravelPct', label: 'Inter-community travel', group: 'Public policy',
      min: 0, max: 100, step: 1, default: 8, unit: '%', requiresCommunities: true,
      help: {
        desc: 'How often people travel between communities — reflects mobility and whether travel between regions is restricted (lockdowns, border controls). (Communities mode only.)',
        up: 'Lots of travel — the disease jumps between communities into a widespread outbreak.',
        down: 'Travel restricted — outbreaks stay local to the community where they start.'
      }
    },

    // ---- Simulation & environment (GLOBAL — shared by both arms) -------------
    {
      key: 'population', label: 'Population', group: 'Simulation & environment',
      min: 20, max: 500, step: 10, default: 300, scope: 'global',
      help: {
        desc: 'Total number of people. In a fixed-size world, more people means a denser, more crowded population.',
        up: 'Denser crowding — faster, larger outbreaks.',
        down: 'Sparser population — slower spread.'
      }
    },
    {
      key: 'initialInfected', label: 'Initially infected', group: 'Simulation & environment',
      min: 1, max: 50, step: 1, default: 11, scope: 'global',
      help: {
        desc: 'How many people are already infected at the start — the size of the initial seeding of the outbreak. Defaults to ~3.5% of the population.',
        up: 'More seed cases — the epidemic takes off faster and from more places.',
        down: 'Fewer seed cases — slower start; a small outbreak may fizzle out.'
      }
    },
    {
      key: 'maxHouseholdSize', label: 'Max household size', group: 'Simulation & environment',
      min: 1, max: 8, step: 1, default: 4, scope: 'global', requiresHouseholds: true,
      help: {
        desc: 'The largest household; people live in groups of a random size up to this, and spread readily to housemates. (Households mode only.)',
        up: 'Bigger families — more in-home transmission once one member is infected.',
        down: 'Smaller households — less in-home spread.'
      }
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
