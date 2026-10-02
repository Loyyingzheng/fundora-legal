const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function must(pattern, message) {
  if (!pattern.test(app)) throw new Error(message);
}

must(/data-admin-item-scope/, 'collapsible rows must expose a stable scope key');
must(/data-admin-item-id/, 'collapsible rows must expose a stable item key');
must(/function rerenderScopedItem\(/, 'row-level rerender helper is required');
must(/loadFeedbackDetail[\s\S]*rerenderScopedItem\('feedback', feedbackId\)/, 'feedback lazy detail must repaint only its row');
must(/loadDiagnosticDetail[\s\S]*rerenderScopedItem\('diagnostic', issueId\)/, 'diagnostic lazy detail must repaint only its row');
must(/finishLoadRequest\(loadRequest, \{ renderAfter: !background \}\)/, 'background refresh must not trigger a page render');
must(/loadFeedbackQueueCounts\(loadRequest, \{ renderAfter: !background \}\)/, 'feedback count refresh must stay silent during background reconciliation');
must(/loadDiagnosticQueueCounts\(loadRequest, \{ renderAfter: !background \}\)/, 'diagnostic count refresh must stay silent during background reconciliation');
must(/mergeMutationResultIntoCurrentList\(result\)/, 'mutation response must merge into the current row model');
must(/window\.scrollTo\(previousScrollX, previousScrollY\)/, 'structural full renders must preserve viewport position');
must(/focus\(\{ preventScroll: true \}\)/, 'structural full renders must restore focused control without scrolling');

console.log('PASS admin non-disruptive row refresh audit');
