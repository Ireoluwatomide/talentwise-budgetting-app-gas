# Budget Tracker — Architecture Notes
## Apps Script Phase (Phase 1)

### Why HtmlService file-per-screen?
Each tab's HTML and JavaScript lives in its own `.html` file under `src/client/screens/`.
These are stitched together server-side via `HtmlService.createTemplateFromFile()` and
the `include()` helper in `Main.gs`. This mirrors a component model without needing npm.

### Why one server file per domain?
Each `.gs` file owns exactly one data concern (Transactions, Goals, Bills, etc.).
This maps directly to one Google Sheet tab per file. Future migration to React + Supabase
means each `.gs` file maps to one Supabase table + one React hook file.

### Why a single AppState object client-side?
Apps Script HtmlService has no React/Zustand. A plain JS object (`AppState`) is the
lightest possible single source of truth. All renders read from AppState; all server
responses write back to AppState before triggering a re-render.

### Why callServer() as a Promise wrapper?
`google.script.run` uses callbacks, not Promises. Wrapping it allows `async/await` usage
in all screen files, making error handling and loading state management consistent.

### Bootstrap data pattern
`doGet()` in `Main.gs` injects all initial data as `window.__BOOTSTRAP__` JSON into the
HTML template. This means the first render is instant — zero extra round-trips on load.
Subsequent mutations go through individual `callServer()` calls.

### Chart.js destroy-before-recreate
Chart.js throws "Canvas already in use" if you create a new chart on a canvas that
already has one. `destroyChart(canvasId)` in `utils.js` cleans up via the `chartRegistry`
before each new chart creation. This is critical since users switch tabs repeatedly.

### Trigger strategy
Two triggers are registered once via `installTriggers()` in `Triggers.gs`:
- **Daily (8 AM WAT)** — sends bill + budget alert emails
- **Monthly (1st, 6 AM)** — applies recurring transactions + resets bill paid status

### Phase 2 migration path
Every server function signature in `*.gs` has a 1:1 mapping to a Supabase SDK call.
`addTransaction(monthKey, name, amount, type, category, note)` becomes
`supabase.from('transactions').insert({...})`. The client-side screens need no changes —
only the `callServer()` bridge is swapped out for direct Supabase SDK calls.