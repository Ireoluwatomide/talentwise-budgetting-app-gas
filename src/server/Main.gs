/**
 * Main.gs — Entry Point
 *
 * PURPOSE:
 *   Serves the HTML shell when the web app URL is opened.
 *   This is the only function Apps Script calls automatically on a GET request.
 *   All other server functions are called explicitly by the client via google.script.run.
 *
 * PATTERN:
 *   Uses HtmlService.createTemplateFromFile() to compose the full-page HTML from
 *   separate screen, component, and utility files — keeping the codebase modular.
 */


/**
 * doGet()
 *
 * TODO: Create an HtmlTemplate from a root shell file (e.g. Index.html if needed)
 *       OR directly assemble the full page HTML here by including:
 *         - styles.css.html    → via HtmlService.createTemplateFromFile()
 *         - utils.js.html      → shared client utilities
 *         - Header.html        → top bar component
 *         - Tabs.html          → tab navigation
 *         - All screen panes   → Overview, Charts, Goals, etc.
 *
 * TODO: Set the page title to "Budget Tracker"
 * TODO: Set XFrameOptionsMode to ALLOWALL if embedding is needed, else leave default
 * TODO: Return the evaluated template as a HtmlOutput
 * TODO: Consider passing initial bootstrap data (current month transactions, preferences)
 *       into the template as a JS variable so the first render is instant (no extra round-trip)
 */
function doGet(e) {
  // TODO: Implement
}


/**
 * include(filename)
 *
 * Helper used inside HTML templates to inline other HTML files.
 * Usage in an .html file: <?!= include('src/client/utils/styles.css') ?>
 *
 * TODO: Implement using HtmlService.createHtmlOutputFromFile(filename).getContent()
 * TODO: Ensure file paths are relative to the Apps Script project root
 */
function include(filename) {
  // TODO: Implement
}


/**
 * getBootstrapData()
 *
 * TODO: Returns a single JSON object with all data needed to render the initial page:
 *         - current month transactions
 *         - goals, bills, savings goals, debts, net worth items, recurring
 *         - user preferences (currency, dark mode, categories)
 *       Batching this into one call avoids multiple round-trips on page load.
 *
 * TODO: Call each domain module (Transactions, Goals, Bills, etc.) and assemble result.
 * TODO: Return as JSON string — parse on client with JSON.parse()
 */
function getBootstrapData() {
  // TODO: Implement
}
