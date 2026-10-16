# Dedicated comparison workspace and report export

## Navigation and layout

- Four peer modules at the top: Power, Energy, DC UPS and Comparison. Comparison is a separate sibling workspace, not a section appended to the calculator grid.
- The comparison source selector chooses one of the three existing engines without introducing a fourth calculation mode. It retains shared input state and updates the comparison immediately.
- “Edit Ni-Zn configuration” returns to the selected calculator. Manual VRLA adjustments remain available in the comparison workspace.
- Comparison uses a top action toolbar, shared-duty summary, check status, benchmark settings, paired scheme cards and three metric cards. Engineering/duty/source details remain expandable.
- Calculator inputs/results use a responsive, unequal-width grid; the shared calculation breakdown sits below the grid as a native `details` component. It is closed on initial load and on every module entry; users can open it without it closing on normal input recalculation.

## Report export

“Export comparison report” reuses the existing export modal and controls: category/parameter selection, all/brief/invert/key selections, filtering, Chinese/English, live preview, Excel/PDF/HTML and printing.

The report is a **snapshot captured when the modal opens**, including the selected calculator, shared conditions, both model/topology/status values, physical quantities, engineering lookup rows, source limits and snapshot timestamp. Language changes preserve the same snapshot and selected IDs. Close/reopen to capture updated values.

- Preview, Excel and PDF/HTML use a true three-column Item / Ni-Zn / VRLA layout. Shared conditions span the two scheme columns.
- Status, issues, source qualifications, scope and temperature limitations cannot be removed, even by bulk deselection or brief presets.
- Failed/unverified schemes export their actual quantities and warnings, but no numeric advantage conclusion.
- Excel uses the existing ExcelJS library, with the existing SheetJS fallback. It is a static report, not an editable sizing engine; units and formatted snapshot values are retained as text.
- PDF uses the existing html2canvas/jsPDF libraries, with row-aware page breaks and repeated report/table headers. If those libraries are unavailable, the existing browser-print fallback remains available.
- Mobile export uses a single scrolling stack (selection, format/actions, preview) to avoid overlapping controls. Desktop retains the existing side-by-side modal.
- The original configuration-report dataset and export paths remain separate; opening one report never carries over the other's rows.

The existing G90 weight-field conflict and all V1 data caveats are unchanged. This work does not choose an authoritative weight, certify source data or add TCO assumptions.

## Tests

`npm test` includes V1 numerical regressions and a new `comparison_report_test.mjs` covering six bilingual engine snapshots, mandatory qualifiers, unique/stable IDs, exact block quantities and failed-report conclusions.

Optional Playwright regressions:

```sh
PLAYWRIGHT_PATH=/path/to/playwright node tests/ui_browser_test.cjs /path/to/chromium
REPORT_TEST_DIR=/tmp/report-fixtures PLAYWRIGHT_PATH=/path/to/playwright \
  node tests/comparison_workspace_browser_test.cjs /path/to/chromium
```

The workspace test exercises peer-module navigation, collapsed steps, all three comparison sources, bilingual report selection, stable snapshots, mandatory safeguards, real XLSX/HTML/PDF downloads, full failed-report pagination, configuration-export isolation and desktop/mobile layouts. `REPORT_TEST_DIR` is optional and stores test artifacts only.
