# Admin audit-script lifecycle

The admin source now uses `auditRegistry.js` as the current contract suite.
Run `node src/scripts/runAuditTests.js` for the core suite, `--extended` for the
larger current suite, and `--historical` only when intentionally validating old
point-in-time audits.

Old scripts are retained for traceability but are no longer part of the default
execution path. New work should extend a current canonical audit whenever possible.
