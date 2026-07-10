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
assert(app.includes('function isDesktopNavigation()'), 'Desktop navigation mode must be explicit.');
assert(app.includes('desktop-persistent'), 'Desktop sidebar must remain interactive and visible.');
assert(css.includes('@media (min-width: 1100px)'), 'Desktop sidebar must have a persistent layout breakpoint.');
assert(css.includes('grid-template-columns: 300px minmax(0, 1fr)'), 'Desktop layout must reserve space for the sidebar.');
console.log('PASS admin governance rendering close-loop audit');
