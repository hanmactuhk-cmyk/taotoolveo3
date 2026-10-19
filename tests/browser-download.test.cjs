const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { downloadBrowserAsset, validateFile, videoSize, serialized } = require('../electron/browser-download');
const { clearHttpCache } = require('../electron/browser-cache');

function mp4(width, height) {
  const atom = (name, payload) => { const bytes = Buffer.alloc(payload.length + 8); bytes.writeUInt32BE(bytes.length); bytes.write(name, 4, 'ascii'); payload.copy(bytes, 8); return bytes; };
  const header = Buffer.alloc(84); header.writeUInt32BE(width * 65536, 76); header.writeUInt32BE(height * 65536, 80);
  return Buffer.concat([atom('ftyp', Buffer.from('isom0000')), atom('moov', atom('trak', atom('tkhd', header)))]);
}

test('MP4 dimensions are verified for landscape and portrait; 720p cannot pass as 1080p', () => {
  const root = fs.mkdtempSync(path.join(__dirname, '.fixture-download-'));
  for (const [w, h] of [[1920,1080],[1080,1920]]) {
    const file = path.join(root, 'video.mp4'); fs.writeFileSync(file, mp4(w,h));
    assert.deepEqual(videoSize(fs.readFileSync(file)), { width: w, height: h });
    assert.equal(validateFile(file, 'video').width, w);
  }
  const low = path.join(root, 'low.mp4'); fs.writeFileSync(low, mp4(1280,720));
  assert.throws(() => validateFile(low, 'video'), /1080p/);
  fs.writeFileSync(low, '<html>Sign in</html>'); assert.throws(() => validateFile(low, 'video'), /MP4/);
});

test('native download uses the correct frame, waits for completion and restores browser behavior', async () => {
  const folder = fs.mkdtempSync(path.join(__dirname, '.fixture-native-'));
  const commands = [], progress = [];
  const browser = { events: [], async connect() {}, dispose() {}, async call(method, params) { commands.push([method,params]); } };
  const page = { async call(method) { return method === 'Page.getFrameTree' ? {frameTree:{frame:{id:'my-frame'}}} : {targetInfo:{}}; }, async bridge(request) {
    assert.equal(request.kind, 'video'); assert.equal(request.assetKey, 'video-one');
    fs.writeFileSync(path.join(folder,'my-guid'),mp4(1920,1080));
    browser.events.push({method:'Browser.downloadWillBegin',params:{guid:'foreign-guid',frameId:'another-frame'}},
      {method:'Browser.downloadWillBegin',params:{guid:'my-guid',frameId:'my-frame'}},
      {method:'Browser.downloadProgress',params:{guid:'my-guid',state:'completed',receivedBytes:100,totalBytes:100}});
  } };
  const saved = await downloadBrowserAsset({page,browserAddress:'ws://127.0.0.1/test',asset:{key:'video-one',kind:'video'},destination:path.join(folder,'result_1080p.mp4'),createClient:()=>browser,onProgress:p=>progress.push(p.percent)});
  assert.equal(saved.height,1080); assert(fs.existsSync(saved.path)); assert.deepEqual(progress,[100]);
  assert.equal(commands[0][1].behavior,'allowAndName'); assert.equal(commands.at(-1)[1].behavior,'default');
});

test('failed native request releases download settings without reporting completion', async () => {
  const commands=[];let disposed=false;
  const browser={events:[],async connect(){},async call(method,params){commands.push([method,params]);},dispose(){disposed=true;}};
  await assert.rejects(downloadBrowserAsset({page:{async call(){return {frameTree:{frame:{id:'x'}},targetInfo:{}};},async bridge(){throw Error('1080p locked');}},browserAddress:'ws://127.0.0.1/fail',asset:{key:'v',kind:'video'},destination:path.join(os.tmpdir(),'flow-unused.mp4'),createClient:()=>browser}),/locked/);
  assert.equal(commands.at(-1)[1].behavior,'default');assert(disposed);
});

test('downloads on one browser serialize; different browsers can run independently', async () => {
  let release;const gate=new Promise(r=>release=r);const seen=[];
  const one=serialized('same',async()=>{seen.push('one');await gate;seen.push('end');});
  const two=serialized('same',async()=>seen.push('two'));
  await serialized('different',async()=>seen.push('other'));
  assert(!seen.includes('two'));release();await Promise.all([one,two]);assert(seen.indexOf('two')>seen.indexOf('end'));
});

test('post-generation cleanup clears only HTTP cache and never authentication storage', async () => {
  const commands=[];await clearHttpCache({async call(...args){commands.push(args);}});
  assert.deepEqual(commands,[['Network.clearBrowserCache',{}]]);
});
