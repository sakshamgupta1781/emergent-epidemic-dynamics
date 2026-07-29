# Epidemic Lab

An interactive, **dependency-free** browser tool for visualizing how a viral
infection spreads through a population and for running **A/B experiments** on the
classic **SIR** (Susceptible · Infected · Removed) curve.

People are dots wandering inside a bounded "city." Each has a visible **infection
radius**; a susceptible person who stays within an infected person's radius long
enough becomes infected, and infected people move to *removed* after an infectious
period. The goal is to explore which interventions **flatten the infection peak**
(reducing pressure on medical infrastructure) and **lower the total removed**.

## Run it

No build step, no server, no internet required — just open the file:

```
open index.html      # macOS
# or double-click index.html in your file browser
```

Everything runs client-side. [Chart.js](https://www.chartjs.org/) is vendored
locally in `lib/` so the tool works fully offline.

## Features

- **Agent-based simulation** — dots move via a bounded random walk; each shows its
  infection-radius ring (infected dots pulse).
- **Live SIR chart** — each series shows the **true current count**:
  Susceptible declines, Infected rises to a **peak** then falls, Removed rises and
  plateaus. A dashed line marks the **peak infected** value.
- **Two global temporal knobs**
  - **Dot speed** — baseline travel speed of the dots.
  - **Time multiplier** — accelerates the whole simulation clock, so *every*
    temporal quantity (movement, contact-time-to-infect, recovery duration) scales
    together.
- **A/B "arm" comparison** — toggle between a **single** view (the treatment) and a
  **compare** view with a *Control* and *Test* arm side-by-side. With **shared seed**
  on, both arms start from an identical state, so any divergence is caused only by the
  parameters you changed. Changed test-arm parameters are **highlighted**.

## Tunable parameters

Grouped by subheading (see `src/params.js` — the single source of truth):

| Group | Parameter | Meaning |
|-------|-----------|---------|
| Disease | Infection radius | Contact distance for possible transmission |
| Disease | Contact time to infect | Continuous time within radius before infection |
| Disease | Infectious duration | Time infected before becoming removed |
| Personal control | Social distancing | % of people who keep their distance |
| Public policy | Quarantine on infection | % of newly infected who stop moving |
| Simulation & environment | Population | Number of people |
| Simulation & environment | Initially infected | People infected at t=0 |

Adding a new parameter is a one-line entry in `src/params.js`; it appears in the UI
and is available to the engine automatically.

## Project structure

```
index.html            # layout + script loading
styles.css            # dark theme, CSS-grid layout
lib/chart.umd.min.js  # vendored Chart.js (offline)
src/
  rng.js              # seeded PRNG (shared-seed determinism)
  params.js           # parameter schema (single source of truth)
  agent.js            # a single person
  simulation.js       # SIR engine: movement, infection, canvas render
  charts.js           # per-arm SIR time-series (Chart.js)
  ui.js               # builds parameter panels + diff highlighting
  app.js              # bootstrap, global controls, main loop
```

## License

MIT
