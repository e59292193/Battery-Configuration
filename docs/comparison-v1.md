# Battery comparison V1

## Scope

This iteration replaces the Ni-Zn / VRLA comparison presentation, keeping the existing calculator and its themes. It compares the current Ni-Zn configuration against a configurable VRLA benchmark under the same load, duration, design factors and system voltage window. The automatic benchmark is a feasible voltage-window match, **not** proof of globally optimal sizing for either chemistry.

- Shared duty summary; calculation pass/warning/failure before any advantage conclusion.
- Paired battery-body weight, battery-body volume and block counts; block counts are configuration scale, not performance rankings.
- Expandable engineering checks, shared duty stages, lookup details and limitations.
- Voltage/topology/load/lookup problems suppress advantage conclusions without hiding actual quantities.
- No invented installation footprint, cabinet count, quotation, lifecycle savings or safety certification.
- Responsive controls and semantic status text; existing theme variables are retained.

## Calculation corrections

- Automatic VRLA series sizing checks charge upper limits and a supported discharge cutoff against the shared bus window; infeasible combinations are flagged.
- DC duty comparison uses actual `currentA` values and the same aging/design factors as Ni-Zn.
- AC manual/energy-mode comparison uses the calculator's actual required power rather than an absent property.
- Charging-voltage fallback uses cells in **one series string**, not cells across parallel strings.
- Missing results, zero demand, inconsistent topology and out-of-table lookups cannot be silently certified.
- Comparison events are initialized on first load, not only after saving a configuration.

## English UI

`public/ui-localization.js` is a small, explicit UI-copy lexicon and reversible DOM bridge for legacy renderers. Include this file alongside `public/index.html` when publishing the static frontend. It watches only application-owned rendering roots and never calls an external translation service.

The new comparison, theme labels, saved-configuration controls, AI-owned configuration controls/validation, system notices and English engineering-rule prompt use language-aware rendering. User input, uploaded filenames, saved names, assistant prose and export content are intentionally not machine-translated. Existing conversation text is not rewritten when toggling language. Export language remains governed by its existing controls.

## Data caveats

The embedded `8XNFG90` model contains `weightKg: 17.3` and `officialWeightKg: 18.3`. V1 retains the main calculator's `weightKg` quantity for consistency, shows the alternate source field, warns about the conflict, and blocks advantage conclusions until the datasheet is verified. This change does not assert which field is authoritative. Embedded discharge data and revisions still require project verification.

Ni-Zn temperature-compensated charging calculations retain the existing model; VRLA comparison uses its embedded nominal float/equalize values, not a newly invented temperature correction. Battery body volume is not installed rack footprint.

## Validation

```sh
npm test
```

Runs the existing engine, DC UPS, i18n/export and lead-acid comparison suites plus 12 new comparison engineering test groups. Existing numerical comparison assertions are retained; old layout assertions are updated for the redesigned DOM.

Optional real-browser regression (Playwright is a development-only dependency):

```sh
npm install --no-save --package-lock=false playwright
node tests/ui_browser_test.cjs /absolute/path/to/chromium
```

Or set `PLAYWRIGHT_PATH` to an existing Playwright package. Tests make no AI API calls. They cover language round trips, six AC/DC mode/duty states, high/low cutoff and long/short duration warnings, settings, English rules and configuration validation, preserved user text, comparison controls/reset, and 1440px/390px layouts. Manual visual checks cover Chinese desktop, expanded English engineering details, and a mobile voltage-failure state.
