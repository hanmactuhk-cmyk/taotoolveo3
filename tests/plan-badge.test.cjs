const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../flow-bridge.js'), 'utf8');
function element(value, selectors = {}) {
  return { innerText: value, textContent: value, children: [], getClientRects: () => [{}],
    querySelectorAll: query => selectors[query] || [], querySelector: query => (selectors[query] || [])[0] || null,
    getAttribute: () => null, closest: () => null };
}
async function read(badge, { frame = false, email = true } = {}) {
  const userEmail = email ? 'fixture@example.invalid' : '';
  const panel = element(userEmail + ' 40 tín dụng Google Flow Nâng cấp Google AI Ultra', {
    '.user-email': email ? [element(userEmail)] : [], '.credits-count': [element('40 tín dụng Google Flow')],
    'span,div': [element('Google AI Ultra')]
  });
  const header = element('', { 'flow-user-tier-chip': badge ? [element(badge)] : [] });
  const context = { Promise, JSON, Number, Set, Error, setTimeout: callback => callback(),
    location: { hostname: frame ? 'ogs.google.com' : 'flow.google.com', pathname: frame ? '/account' : '/project/test' },
    getComputedStyle: () => ({ visibility: 'visible' }),
    document: { body: panel, querySelectorAll: query => query === '.header-user-button,flow-header-user-icon' ? frame ? [] : [header] : query === '[role="dialog"],dialog' ? [panel] : [] }
  };
  return vm.runInNewContext(source.replace('__FLOWDESK_REQUEST__', JSON.stringify({ action: 'account', accountFrame: frame, headerPlan: frame ? badge : undefined })), context);
}
for (const [badge, plan] of [['PLUS', 'Plus'], ['PRO', 'Pro'], ['ULTRA', 'Ultra']]) {
  test('account plan reads ' + badge + ' from avatar badge', async () => {
    const result = await read(badge); assert.equal(result.ok, true); assert.equal(result.data.plan, plan);
  });
}
test('logged-in account without avatar badge is Free, ignoring upgrade advertising', async () => {
  const result = await read(''); assert.equal(result.data.plan, 'Free'); assert.equal(result.data.credits, 40);
});
test('paid avatar plan is retained while reading email/credits in account iframe', async () => {
  const result = await read('Plus', { frame: true }); assert.equal(result.data.plan, 'Plus');
});
test('missing login/email cannot become a verified Free account', async () => {
  const result = await read('', { email: false }); assert(result.ok === false || result.data.plan === 'Unknown');
});
