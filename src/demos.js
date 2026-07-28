/*
 * demos.js — curated experiment templates for "Demo mode".
 *
 * Each demo sets up a clean A/B comparison that isolates ONE variable so a new
 * user can pick it and immediately see an effect. The registry is data-driven:
 * adding a demo is a single object here. app.js reads App.DEMOS to build the
 * dropdown and applies a selection via applyDemo().
 *
 * Demo shape:
 *   id            unique identifier (dropdown option value)
 *   label         human-readable name shown in the dropdown
 *   view          experiment view to enter ('compare')
 *   populationMode  'individuals' | 'households' | 'communities'
 *   description   the explanatory line printed under the dropdown
 *   control/test  per-arm parameter overrides applied AFTER a reset to defaults
 *                 (so the arms differ only in the studied variable)
 *   globals       optional global-param overrides applied to both arms
 *                 (e.g. { population, initialInfected })
 */
(function (App) {
  'use strict';

  var DEMOS = [
    {
      id: 'travel-restrictions',
      label: 'Importance of travel restrictions',
      view: 'compare',
      populationMode: 'communities',
      description:
        'Measures the impact of travel on a population of semi-connected communities. ' +
        'Both arms are identical except inter-community travel: Control 8% vs Treatment 1%. ' +
        'Hit ▶ Play to start the simulation.',
      control: { interCommunityTravelPct: 8 },
      test: { interCommunityTravelPct: 1 }
    }
  ];

  App.DEMOS = DEMOS;
})(window.App = window.App || {});
