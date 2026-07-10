const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..', '..');
const app = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

const loaderStart = app.indexOf('async function loadAdminControlData');
const loaderEnd = app.indexOf('async function loadData', loaderStart);
const loader = app.slice(loaderStart, loaderEnd > loaderStart ? loaderEnd : loaderStart + 15000);
assert(!loader.includes('children.push(renderMyAccountSecurityPage())'), 'Renderers must not be placed inside the async data loader.');

const rendererStart = app.indexOf('function renderAdminControlPage');
const rendererEnd = app.indexOf('function renderUsageAdjustModal', rendererStart);
const renderer = app.slice(rendererStart, rendererEnd > rendererStart ? rendererEnd : rendererStart + 40000);
assert(renderer.includes("state.activeTab === 'myAccount'"), 'My Account must render in renderAdminControlPage.');
assert(renderer.includes('renderMyAccountSecurityPage()'), 'My Account security UI must be attached to the page renderer.');
assert(renderer.includes('renderAdminAccountsGovernancePage()'), 'Admin Accounts must be attached to the page renderer.');
assert(renderer.includes('renderSystemOwnershipPage()'), 'System Ownership must be attached to the page renderer.');
assert(app.includes('const navigationVisible = state.navOpen;'), 'Sidebar visibility must follow the explicit open state at every viewport width.');
assert(!app.includes('desktopNavigation || state.navOpen'), 'Desktop width must not force the drawer open after Close is pressed.');
assert(!app.includes('desktop-persistent'), 'The drawer must not have a non-closable desktop-only mode.');
assert(app.includes("onclick: closeNavigation"), 'Sidebar Close and backdrop actions must call closeNavigation.');
assert(app.includes("tabindex: state.navOpen ? '0' : '-1'"), 'Backdrop keyboard focus must follow the drawer open state.');
assert(!css.includes('display: none !important;\n  }\n\n  .admin-layout'), 'Desktop CSS must not hide the menu trigger and force a persistent sidebar.');
assert(!css.includes('\\n\\n/* Admin governance'), 'Stylesheet must not contain escaped newline text that invalidates appended CSS.');
console.log('PASS admin governance rendering close-loop audit');
