const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveModel, configuredFields, jobImages, resetJob } = require('../electron/job-utils');
const { syncDrafts } = require('../electron/drafts');
const JobRunner = require('../electron/job-runner');

function fixture(count = 'x1') {
  const root = fs.mkdtempSync(path.join(__dirname, '.fixture-'));
  const job = { Id: 'job-original', Kind: 'image', Model: 'Nano Banana 2 Lite', Ratio: '16:9', Count: count,
    Mode: 'Văn bản / Ảnh tham chiếu → Ảnh', Prompt: 'original', References: [], State: 'Hàng đợi',
    Submitted: false, AccountId: '', Results: [], Attempts: [] };
  const account = { Id: 'account-a', Name: 'A', LoginStarted: true, Enabled: true, Images: true, Videos: true };
  const store = { data: { Accounts: [account], Queue: [job], OutputFolder: root }, save() {} };
  const calls = [];
  let releases;
  const browser = {
    async connectFlowTab(acc, options) {
      const clientId = calls.filter(item => item.action === 'connect').length;
      calls.push({ action: 'connect', options });
      let prompt;
      return {
        async enableDiagnostics() {}, dispose() {}, async uploadImage() {}, async call() {},
        async bridge(request) {
          calls.push({ ...request, clientId });
          switch (request.action) {
            case 'account': return { email: 'fixture@example.invalid', plan: 'Free', credits: 50 };
            case 'catalog': return { models: [{ name: '🍌 Nano Banana 2 Lite', disabled: false }] };
            case 'status': return { url: `https://flow.google.com/project/fixture-${clientId}` };
            case 'configure': return { cost: 0, fields: [
              { name: 'Tỷ lệ khung hình', options: [{ name: '16:9' }] },
              { name: 'Số lượng kết quả đầu ra', options: [{ name: count }] }
            ] };
            case 'verifyConfig': return {};
            case 'fill': prompt = request.prompt; return {};
            case 'ready': return { prompt, enabled: true, url: `https://flow.google.com/project/fixture-${clientId}` };
            case 'mediaBaseline': return { cards: [], urls: [] };
            case 'submit': return { submitted: true };
            case 'jobStatus': if (releases && clientId === 0) await releases; return { urls: ['https://storage.googleapis.com/fixture.png'] };
            default: throw new Error(request.action);
          }
        }
      };
    }, async close() {}, async closeJobTab() {}
  };
  const runner = new JobRunner(store, browser, () => {}, { monitorTimeout: 200, pollInterval: 0 });
  runner.setCooldown = () => {};
  runner.downloadFile = async (url, dest) => { fs.writeFileSync(dest, 'fixture'); return dest; };
  return { job, account, store, browser, runner, calls, hold(promise) { releases = promise; } };
}

test('model matching tolerates UI punctuation but never substitutes another model', () => {
  assert.equal(resolveModel([{ name: '🍌 Nano Banana 2 Lite' }], 'Nano Banana 2 Lite'), '🍌 Nano Banana 2 Lite');
  assert.equal(resolveModel([{ name: 'Veo 3.1 - Fast' }], 'Veo 3.1 Fast'), 'Veo 3.1 - Fast');
  assert.throws(() => resolveModel([{ name: 'Veo 3.1 - Quality' }], 'Veo 3.1 Fast'), /không có/);
});

test('video mode and uploads honor start/end versus ingredients', () => {
  const job = { Kind: 'video', Ratio: '9:16', Count: 'x1', Mode: 'Văn bản / Khung hình → Video', StartImage: 'a', EndImage: 'b', References: [] };
  assert.deepEqual(jobImages(job), [{ slot: 'start', path: 'a' }, { slot: 'end', path: 'b' }]);
  assert.deepEqual(configuredFields({ fields: [
    { name: 'Loại video', options: [{ name: 'Khung hình' }, { name: 'Thành phần' }] },
    { name: 'Tỷ lệ', options: [{ name: '9:16' }] }, { name: 'Số lượng', options: [{ name: 'x1' }] }
  ] }, job).find(field => field.name === 'Loại video'), { name: 'Loại video', value: 'Khung hình' });
  assert.throws(() => configuredFields({ fields: [] }, job), /tùy chọn/);
  job.Mode = 'Thành phần → Video'; job.References = ['r'];
  assert.deepEqual(jobImages(job), [{ slot: 'reference', path: 'r' }]);
});

test('draft synchronization retains selected row images and supports one prompt per image', () => {
  const store = { data: { Queue: [] }, save() {} };
  const payload = { kind: 'image', prompts: ['a'], model: 'Nano Banana', ratio: '16:9', count: 'x1', references: [], accountId: 'a' };
  syncDrafts(store, payload); const job = store.data.Queue[0];
  job.References = ['picked']; job.UseGlobalReferences = false;
  syncDrafts(store, { ...payload, prompts: ['edited'], accountId: 'auto' });
  assert.equal(store.data.Queue.length, 1); assert.equal(job.Prompt, 'edited'); assert.equal(job.AccountId, '');
  assert.deepEqual(job.References, ['picked']);
  syncDrafts(store, { ...payload, prompts: ['shared'], references: ['1', '2'], samePrompt: true });
  assert.equal(store.data.Queue.length, 2); assert.deepEqual(store.data.Queue[1].References, ['2']);
});

test('job requires account/configuration and submits once to its own page (mock CDP)', async () => {
  const f = fixture(); await f.runner.runQueue({ kind: 'image' });
  assert.equal(f.job.State, 'Hoàn tất'); assert.equal(f.job.Results.length, 1);
  assert.equal(f.calls.filter(call => call.action === 'submit').length, 1);
  assert.equal(f.calls.find(call => call.action === 'connect').options.newTab, true);
  assert.equal(f.job.Model, '🍌 Nano Banana 2 Lite');
});

test('failed download does not report success; submitted command becomes uncertain', async () => {
  const f = fixture(); f.runner.downloadFile = async () => { throw new Error('download failed'); };
  await f.runner.runQueue({ kind: 'image' });
  assert.equal(f.job.State, 'Cần kiểm tra'); assert.equal(f.job.Results.length, 0); assert.equal(f.job.Submitted, true);
});

test('job failure keeps Chrome/tab open by default for inspection', async () => {
  const f = fixture(); let closed = 0;
  f.browser.close = async () => { closed++; }; f.browser.closeJobTab = async () => { closed++; };
  f.runner.downloadFile = async () => { throw new Error('failed'); };
  await f.runner.runQueue({ kind: 'image' });
  assert.equal(f.job.State, 'Cần kiểm tra'); assert.equal(closed, 0);
});

test('explicit legacy close-on-error option remains available', async () => {
  const f = fixture(); let closed = 0; f.browser.close = async () => { closed++; };
  f.runner.downloadFile = async () => { throw new Error('failed'); };
  await f.runner.runQueue({ kind: 'image', closeBrowserOnError: true }); assert.equal(closed, 1);
});

test('requested x2 waits for two downloaded files', async () => {
  const f = fixture('x2'); let reads = 0;
  const client = { async bridge() { return { urls: ++reads === 1 ? ['https://storage.googleapis.com/one'] : ['https://storage.googleapis.com/one', 'https://storage.googleapis.com/two'] }; } };
  f.job.Folder = f.store.data.OutputFolder;
  await f.runner.monitorJob(client, f.job);
  assert.equal(f.job.Results.length, 2); assert.equal(reads, 2); assert.equal(f.job.State, 'Hoàn tất');
});

test('regenerate retains ID/assets and creates a clean execution with history', () => {
  const f = fixture(); f.job.StartImage = 'start'; f.job.EndImage = 'end'; f.job.Url = 'old';
  f.job.Submitted = true; f.job.SentPrompt = 'sent'; f.job.Prompt = 'edited';
  resetJob(f.job);
  assert.equal(f.job.Id, 'job-original'); assert.equal(f.job.Prompt, 'edited'); assert.equal(f.job.Attempts[0].Prompt, 'sent');
  assert.equal(f.job.StartImage, 'start'); assert.equal(f.job.EndImage, 'end'); assert.equal(f.job.Url, ''); assert.equal(f.job.Submitted, false);
});

test('retry during monitoring waits; original sent prompt is not mutated', async () => {
  const f = fixture(); let release; f.hold(new Promise(resolve => { release = resolve; }));
  const task = f.runner.runQueue({ kind: 'image' });
  while (!f.calls.some(call => call.action === 'jobStatus')) await new Promise(resolve => setTimeout(resolve, 1));
  f.job.Prompt = 'edited'; f.runner.retryJob(f.job.Id);
  assert.equal(f.job.SentPrompt, 'original'); assert.equal(f.job.Submitted, true);
  release(); await task;
  assert.equal(f.store.data.Queue.length, 1); assert.equal(f.job.Attempts.length, 1);
  assert.deepEqual(f.calls.filter(call => call.action === 'fill').map(call => call.prompt), ['original', 'edited']);
  assert.equal(new Set(f.calls.filter(call => call.action === 'submit').map(call => call.jobId)).size, 2);
});

test('stop drains already submitted worker without sending next queued job', async () => {
  const f = fixture(); const other = { ...f.job, Id: 'job-second', Results: [], Attempts: [] }; f.store.data.Queue.push(other);
  let release; f.hold(new Promise(resolve => { release = resolve; }));
  const task = f.runner.runQueue({ concurrent: 1, kind: 'image' });
  while (!f.calls.some(call => call.action === 'jobStatus')) await new Promise(resolve => setTimeout(resolve, 1));
  f.runner.stop(); assert.equal(f.runner.running, true);
  release(); await task;
  assert.equal(f.job.State, 'Hoàn tất'); assert.equal(other.State, 'Hàng đợi'); assert.equal(f.runner.running, false);
});

test('native result assets download before completion and HTTP cache cleanup', async () => {
  const f=fixture();f.account.BrowserId='ws://127.0.0.1/browser/fixture';
  const connect=f.browser.connectFlowTab.bind(f.browser);let saved=false;const cache=[];
  f.browser.connectFlowTab=async(...args)=>{const client=await connect(...args),bridge=client.bridge.bind(client);client.call=async method=>{if(method==='Network.clearBrowserCache'){cache.push(method);assert(saved);}};client.bridge=async request=>request.action==='jobStatus'?{assets:[{key:'tile-1',fingerprint:'media-1',kind:'image'}],progress:100}:bridge(request);return client;};
  f.runner.downloadAsset=async(page,account,asset,target,onProgress)=>{onProgress({percent:42});assert.equal(f.job.State,'Đang chạy');fs.writeFileSync(target,'fixture');saved=true;return {path:target};};
  await f.runner.runQueue({kind:'image'});
  assert.equal(f.job.State,'Hoàn tất');assert.equal(f.job.DownloadProgress,100);assert.deepEqual(cache,['Network.clearBrowserCache']);
});

test('remounted tile cannot be counted twice toward x2 results',async()=>{
  const f=fixture('x2');f.account.BrowserId='ws://127.0.0.1/browser/fixture';f.job.AccountId=f.account.Id;f.job.Folder=f.store.data.OutputFolder;let polls=0,downloads=0;
  const page={async bridge(request){if(request.action==='scrollResults')return {};polls++;return {assets:polls<3?[{key:'tile-'+polls,fingerprint:'same-media',kind:'image'}]:[{key:'other',fingerprint:'second-media',kind:'image'}]};}};
  f.runner.downloadAsset=async(page,account,asset,target)=>{downloads++;fs.writeFileSync(target,'fixture');return {path:target};};
  await f.runner.monitorJob(page,f.job);assert.equal(polls,3);assert.equal(downloads,2);assert.equal(f.job.Results.length,2);
});

test('scheduler runs ten or more workers without an eight-job cap',async()=>{
 for(const concurrent of [10,12]){
  const f=fixture();f.store.data.Queue=Array.from({length:concurrent+1},(_,i)=>({...f.job,Id:'parallel-'+i,Results:[],Attempts:[]}));
  let release;const gate=new Promise(resolve=>release=resolve);let active=0,peak=0;
  f.runner.processJob=async job=>{active++;peak=Math.max(peak,active);job.State='Đang chạy';await gate;job.State='Hoàn tất';active--;};
  const task=f.runner.runQueue({concurrent});
  try {await new Promise(resolve=>setTimeout(resolve,20));assert.equal(peak,concurrent);assert.equal(f.runner.workers.size,concurrent);}
  finally{release();await task;}
  assert(f.store.data.Queue.every(job=>job.State==='Hoàn tất'));
 }
});

test('two automatic parallel jobs use different enabled accounts',async()=>{
 const f=fixture();f.store.data.Accounts.push({...f.account,Id:'account-b',Name:'B'});
 const second={...f.job,Id:'job-second',Results:[],Attempts:[]};f.store.data.Queue.push(second);
 let release;f.hold(new Promise(resolve=>release=resolve));const task=f.runner.runQueue({concurrent:2});
 while(f.calls.filter(c=>c.action==='connect').length<2)await new Promise(r=>setTimeout(r,1));
 assert.equal(f.job.AccountId,'account-a');assert.equal(second.AccountId,'account-b');release();await task;
 assert.equal(f.job.State,'Hoàn tất');assert.equal(second.State,'Hoàn tất');
});

test('one account gets two separate job tabs while prompt entry is serialized',async()=>{
 const f=fixture(),second={...f.job,Id:'job-second',Results:[],Attempts:[]};f.store.data.Queue.push(second);
 const connect=f.browser.connectFlowTab.bind(f.browser);let release,fills=0;const gate=new Promise(r=>release=r);
 f.browser.connectFlowTab=async(...args)=>{const client=await connect(...args),bridge=client.bridge.bind(client);client.bridge=async request=>{if(request.action==='fill'){fills++;if(fills===1)await gate;}return bridge(request);};return client;};
 const task=f.runner.runQueue({concurrent:2});
 while(f.calls.filter(c=>c.action==='connect').length<2||fills===0)await new Promise(r=>setTimeout(r,1));
 assert.equal(fills,1);assert(f.calls.filter(c=>c.action==='connect').every(c=>c.options.newTab));release();await task;
 assert.equal(fills,2);assert.notEqual(f.job.Url,second.Url);assert.equal(f.job.AccountId,second.AccountId);
});

test('account picker rotates ties and respects explicitly selected account',()=>{
 const f=fixture();f.store.data.Accounts.push({...f.account,Id:'b'},{...f.account,Id:'c'});
 assert.deepEqual([f.runner.pickAccount(f.job).Id,f.runner.pickAccount(f.job).Id,f.runner.pickAccount(f.job).Id],['account-a','b','c']);
 assert.equal(f.runner.pickAccount({...f.job,AccountId:'b'}).Id,'b');
});

test('original Flow error and stage are kept in separate per-job and error logs',async()=>{
 const f=fixture(),message='Không thể tạo video.\nMáy chủ trả về lỗi thử nghiệm.';
 const connect=f.browser.connectFlowTab.bind(f.browser);f.browser.connectFlowTab=async(...args)=>{const client=await connect(...args),bridge=client.bridge.bind(client);client.bridge=async request=>request.action==='jobStatus'?{error:message}:bridge(request);return client;};
 await f.runner.runQueue();assert.equal(f.job.Note,message);assert.equal(f.job.LastError.message,message);assert.equal(f.job.LastError.stage,'Theo dõi Flow');
 assert(fs.readFileSync(f.job.LogFile,'utf8').includes(message));assert(fs.readFileSync(path.join(f.store.data.OutputFolder,'logs/errors.log'),'utf8').includes(message));
});
