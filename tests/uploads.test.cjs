const test = require('node:test');
const assert = require('node:assert/strict');
const CdpClient = require('../electron/cdp-client');

test('upload waits for asynchronous file chooser and targets the requested frame', async () => {
  const client = new CdpClient(); const calls = []; const actions = [];
  client.call = async (method, params) => { calls.push({ method, params }); return {}; };
  client.bridge = async request => {
    actions.push(request);
    if (request.action === 'attachmentCount') return { count: 0 };
    if (request.action === 'upload') setTimeout(() => client.events.push({ method: 'Page.fileChooserOpened', params: { backendNodeId: 77 } }), 20);
    return { attached: true };
  };
  await client.uploadImage(__filename, 'end');
  assert.equal(calls.find(item => item.method === 'DOM.setFileInputFiles').params.backendNodeId, 77);
  assert.equal(actions.find(item => item.action === 'upload').slot, 'end');
  assert.equal(actions.find(item => item.action === 'finishUpload').slot, 'end');
  assert.deepEqual(calls.filter(item => item.method === 'Page.setInterceptFileChooserDialog').map(item => item.params.enabled), [true, false]);
});

test('crop/attachment failure releases file chooser interception without hiding the error', async () => {
  const client = new CdpClient(); const calls = [];
  client.call = async (method, params) => { calls.push({ method, params }); return {}; };
  client.bridge = async request => {
    if (request.action === 'attachmentCount') return { count: 0 };
    if (request.action === 'upload') client.events.push({ method: 'Page.fileChooserOpened', params: { backendNodeId: 77 } });
    if (request.action === 'finishUpload') throw new Error('crop incomplete');
    return {};
  };
  await assert.rejects(client.uploadImage(__filename, 'start'), /crop incomplete/);
  assert.equal(calls.at(-1).params.enabled, false);
});

test('missing protocol event fails instead of using a file input from a different page', async () => {
  const client = new CdpClient();
  await assert.rejects(client.waitForProtocolEvent('Page.fileChooserOpened', 1), /chưa trả sự kiện/);
});
