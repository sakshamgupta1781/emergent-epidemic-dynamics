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
      label: 'Implications of Travel Restrictions',
      view: 'compare',
      populationMode: 'communities',
      description:
        'A pandemic takes hold and governments impose travel restrictions between regions. ' +
        'This demo models that policy across a set of semi-connected communities: the Control ' +
        'arm keeps inter-community travel at 8%, while the Treatment arm restricts it to 1%. ' +
        'Watch how limiting movement between communities keeps outbreaks localized and slows ' +
        'the overall spread. Hit ▶ Play to start the simulation.',
      control: { interCommunityTravelPct: 8 },
      test: { interCommunityTravelPct: 1 }
    },
    {
      id: 'personal-agency',
      label: 'Importance of Personal Agency',
      view: 'compare',
      populationMode: 'households',
      description:
        'Even without government mandates, everyday individual choices shape an epidemic. ' +
        'This demo runs households where the Treatment arm adopts voluntary precautions — ' +
        '20% keep their distance and 15% practise good hygiene (masks, handwashing, covering ' +
        'coughs) — while the Control arm does neither. See how modest, self-directed behavior ' +
        'flattens the curve compared with taking no precautions. Hit ▶ Play to start the ' +
        'simulation.',
      test: { socialDistancingPct: 20, hygienePct: 15 }
      // control omitted → stays at defaults (0% distancing, 0% hygiene)
    },
    {
      id: 'quarantine-policy',
      label: 'Implications of a Quarantine Policy',
      view: 'compare',
      populationMode: 'individuals',
      description:
        'When cases climb, authorities stand up a quarantine program to isolate the infected. ' +
        'This demo enables that policy on the Treatment arm only: once 5% of the population has ' +
        'been infected, government quarantine kicks in and 20% of infected people comply by ' +
        'moving into an isolated ward — while the Control arm has no quarantine at all. See how ' +
        'even partial isolation of the contagious blunts the peak. Hit ▶ Play to start the ' +
        'simulation.',
      test: { quarantineEnabled: true, quarantineTriggerPct: 5, quarantineCompliancePct: 20 }
      // control omitted → stays at defaults (quarantine disabled)
    },
    {
      id: 'ebola-vs-covid',
      label: 'Ebola vs COVID-19',
      view: 'compare',
      populationMode: 'communities',
      globals: { population: 190, initialInfected: 3 },
      description:
        'Compares two very different diseases across a set of semi-connected communities. The ' +
        'Control arm is Ebola: a large infection radius and near-instant transmission make it ' +
        'fiercely infectious, but a very short infectious period removes people so fast that ' +
        'the outbreak burns itself out inside a single community before it can travel. The ' +
        'Treatment arm is COVID-19: less intense per contact, but a much longer infectious ' +
        'period lets it seep across communities. The hypothesis — Ebola’s very ferocity, ' +
        'infecting and removing people quickly, is exactly why it struggles to cross over into ' +
        'other communities and geographies, while milder, longer-lasting COVID-19 spreads far ' +
        'wider. Hit ▶ Play to start the simulation.',
      control: {
        infectionRadius: 30, contactDurationToInfect: 0.5,
        infectiousDuration: 2, interCommunityTravelPct: 2
      },
      test: {
        infectionRadius: 20, contactDurationToInfect: 1,
        infectiousDuration: 14, interCommunityTravelPct: 2
      }
    }
  ];

  App.DEMOS = DEMOS;
})(window.App = window.App || {});
