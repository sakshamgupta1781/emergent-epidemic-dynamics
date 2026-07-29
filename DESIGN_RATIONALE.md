# Design Rationale — Epidemic Lab

A dependency-free, browser-based tool for understanding **emergent dynamics in viral spread** —
and the methodologies and strategies used to shape it, contain it, and dull its impact. You
watch an outbreak unfold, experiment with different containment strategies, and analyze their
impact side by side. It's built to sharpen **public-policy** intuition — especially *when* to
enforce an intervention — so that containing a disease becomes something you can predict rather
than guess at.

**Theme 1 — Exploration & Understanding.** Compartmental models are the workhorse of
epidemiology research, but the field is fairly theoretical and equation-heavy — its dynamics are
far easier to *understand* through an actual simulation than through the math. We hear constantly
about strategies for controlling infectious viral diseases, yet it's genuinely hard to grasp how
the mechanics of each one really work. This tool takes the guessing out of it and grounds
understanding in facts and simulation: you build intuition about epidemic spread through direct
manipulation rather than reading.

---

## 1. Set it up & run it

No build, no server, no npm, no internet. It runs straight from a file.

```bash
git clone https://github.com/sakshamgupta1781/epidemic-lab.git
cd epidemic-lab
```

Then **open `index.html`** — double-click it in your file browser (or `open index.html` on
macOS). That's it. [Chart.js](https://www.chartjs.org/) is vendored locally in `lib/`, so the
whole thing works fully offline.

**First 30 seconds:** in the left column, pick a **Demo** (e.g. *Ebola vs COVID-19*) and hit
**▶ Play**. Or build your own experiment with the **Single / Compare / Batch** controls on the
right.

---

## 2. Why this theme, and why this approach

Epidemics are the textbook example of an **emergent system**: nobody designs the famous
S-I-R curve. It *emerges* from a few simple rules applied to many individuals — people wander,
a susceptible person who lingers close to an infected person long enough catches it, and the
infected recover (are "removed") after a while. Out of that local behavior comes a global shape:
susceptibles decline, infections rise to a **peak** and fall, removed climbs and plateaus.

A static chart can *show* you that curve. It can't build intuition for the questions that
actually matter: *why* does the peak form when it does? *why* does one intervention flatten it
while another barely moves it? *why* does a more contagious disease sometimes spread less far?

So the approach is **understanding by manipulation, not by reading**:

- An **agent-based sandbox you can watch** — real dots in a bounded "city," each infected dot
  pulsing its infection radius — wired to a **live SIR chart** so you see cause (contacts) and
  effect (the curve) at the same time.
- **A/B experimentation** (Control vs Treatment) so you learn *causally*: change one lever, hold
  everything else fixed, and see what it does.
- **Demo mode** — pre-built scenarios with tuned defaults across the different variables and
  controls, so you can simulate a specific situation (travel restrictions, personal precautions,
  quarantine policy, Ebola vs COVID-19) in one click instead of configuring every knob by hand.
- An optional **LLM explainer** that reads the actual run and tells you, in plain terms, what
  happened and what to try next — closing the loop from *observation* to *understanding*.

That chain — watch it → experiment on it → have it explained — is the whole design thesis.

---

## 3. What makes it interesting or non-obvious

- **Public policy can be data- and experiment-driven.** This tool gives an *early indication* of
  which containment strategies are worth pursuing. A simplified model of population and infection
  behavior won't prove a policy works at national scale, but it can confidently rule out
  approaches unlikely to hold up in a bigger setting — so you know which decision branches to
  *prune*, and which of the remaining options are worth implementing and testing further.
- **The A/B comparison is a real experimental control.** Both arms start from the *same* seeded
  random state, so any divergence between them is caused *only* by the parameter you changed —
  not by luck. Changed parameters are highlighted so the independent variable is obvious. This is
  a controlled experiment, not two unrelated runs side by side.
- **Different population and disease modes uncover *why* an outcome is surprising.** You can run
  the same disease across *individuals*, *households*, and *communities*, and dial in different
  disease profiles — and it's the *interaction* between the two that produces results you wouldn't
  predict. The **Ebola vs COVID-19** demo makes this vivid: the *more* infectious disease (Ebola —
  large radius, near-instant transmission) actually spreads *less* far, because it removes its
  hosts so fast that it burns out inside one community before it can travel, while milder,
  longer-lasting COVID-19 seeps across the whole map. The tool doesn't just show you the
  surprising result — it lets you take it apart and understand the mechanism behind it.
- **Measuring statistical significance.** A one-off run can be noisy and high-variance, which
  makes any single result misleading. **Batch mode** runs many paired, headless simulations
  across all three population modes to tighten the confidence intervals — reporting the mean
  delta, a **p-value** (paired t-test), and a significance verdict — so a claim like "this
  strategy helped" is actually defensible.
- **AI-assisted explanation.** With your own Anthropic API key (optional), the tool sends the
  exact parameters and the full time series to Claude for a short, plain-language read. It helps
  you understand not just *why* some strategies work, but — more importantly — *why others don't*,
  and the specific scenarios in which a strategy that failed here might actually succeed.

---

## 4. Key design decisions & tradeoffs

Each below is stated as **decision → why → tradeoff**.

- **A deliberately simplified population model.** People move as a randomized walk, and the model
  intentionally *leaves out* real-world complications:
  - **asymptomatic carriers**;
  - the impact of **immunity and reinfection**;
  - **immunization rollout**;
  - **differences in age and mortality data**.

  → *Why:* the aim is controls that are easy to understand and a clear read on the general trends
  of the compartmental (SIR) model — not epidemiological precision. → *Tradeoff:* it won't produce
  accurate real-world forecasts; it trades fidelity for clarity, keeping the core point — how the
  S-I-R curve shifts when you change one lever — front and center rather than getting lost in the
  depths of modeling real population behavior.
- **A deliberately simplified disease model.** A disease here is just three tunable knobs —
  *infection radius*, *contact-time-to-infect*, and *infectious duration*. Real disease modeling
  is far richer:
  - a per-contact **transmission probability / R₀** instead of a deterministic contact time;
  - a **latent (exposed) stage** before a person becomes infectious;
  - **pre-symptomatic and asymptomatic** transmission;
  - an **infectiousness profile** that rises and falls with viral load rather than staying flat;
  - splitting "removed" into **recovered vs. died** via a case-fatality rate;
  - **over-dispersion / superspreading** (a small fraction of people drive most transmission);
  - **waning immunity, reinfection, and cross-immunity** across strains/variants;
  - **seasonality**;
  - **route-of-transmission or dose-response** effects (airborne vs. contact, cumulative-exposure thresholds).

  → *Why:* three intuitive knobs keep the cause→effect link legible so the core mechanics of the
  compartmental (SIR) model land. → *Tradeoff:* far less epidemiological realism — deliberately,
  again choosing clarity over depth so the general trends come across instead of drowning the
  user in disease-modeling detail.

---

## 5. How I'd extend it with more time

- **Richer, more realistic population modeling.** Today people move as a randomized walk. Real
  populations follow *deterministic* daily patterns worth capturing: people who live in
  **households** and **commute during the day** to shared hubs — public transport, offices,
  markets, and other places of interest — mixing with specific groups there before returning
  home; **communities that interact with one another at different probabilities** rather than
  uniformly; **within-household quarantine** (someone who falls sick isolates from the rest of
  their household); and **individuals carrying different immunity levels**. None of these
  behaviors is modeled today.
- **Better disease modeling.** Add the mechanics a real pathogen has — **incubation rates and
  latent periods** (the exposed-but-not-yet-infectious stage), and diseases that **behave
  differently under different environmental conditions** (seasonality, temperature/humidity,
  indoor vs. outdoor).
- **Model evaluations.** Build proper **evals** to measure how accurate these models actually
  are — a rigorous way to quantify the outcomes and put **confidence intervals** on them, so we
  know how far any given result can be trusted.
- **Medical interventions.** Model the impact of **disease treatments** (which shorten the
  infectious period or lower fatality) and a **vaccination rollout** (moving people to immune
  before they're ever infected, at some coverage and rate), so users can weigh medical responses
  alongside behavioral and policy ones.

---

## 6. Approximately how long I spent

**~2–3 hours** of hands-on work (the commit history spans a few calendar days, but the effort
was concentrated).
