const test=require('node:test');
const assert=require('node:assert/strict');
const CdpClient=require('../electron/cdp-client');

function fixture(){const client=new CdpClient(),calls=[],actions=[];client.call=async(method,params)=>{calls.push({method,params});return {};};client.bridge=async request=>{actions.push(request);return request.action==='selectPrompt'?{focused:true}:{confirmed:true};};return {client,calls,actions};}
test('long prompt is inserted in one complete operation before exact confirmation',async()=>{
 const f=fixture(),prompt='x'.repeat(3156)+'y'.repeat(29);await f.client.fillPrompt(prompt);
 const inserted=f.calls.filter(c=>c.method==='Input.insertText');assert.equal(inserted.length,1);assert.equal(inserted[0].params.text.length,3185);assert.equal(inserted[0].params.text,prompt);
 assert.deepEqual(f.actions.map(a=>a.action),['prepareFill','selectPrompt','confirmFill']);assert.equal(f.actions.at(-1).prompt,prompt);
 assert(!f.calls.some(c=>c.method==='Input.dispatchKeyEvent'));assert(!f.actions.some(a=>a.action==='submit'));
});
test('Vietnamese, emojis and newlines are not split across input chunks',async()=>{const f=fixture(),prompt='Một bông hoa 🌼\nÁnh sáng dịu 🌞';await f.client.fillPrompt(prompt);assert.equal(f.calls.find(c=>c.method==='Input.insertText').params.text,prompt);});
test('failed focus stops before writing any prompt',async()=>{const f=fixture();f.client.bridge=async()=>({focused:false});await assert.rejects(f.client.fillPrompt('hello'),/tiêu điểm/);assert(!f.calls.some(c=>c.method==='Input.insertText'));});
test('confirmation failure is surfaced without resubmitting or retyping',async()=>{const f=fixture(),bridge=f.client.bridge;f.client.bridge=async request=>{if(request.action==='confirmFill')throw Error('prompt mismatch');return bridge(request);};await assert.rejects(f.client.fillPrompt('hello'),/mismatch/);assert.equal(f.calls.filter(c=>c.method==='Input.insertText').length,1);});
test('empty prompts fail without changing the page',async()=>{const f=fixture();await assert.rejects(f.client.fillPrompt('  '),/trống/);assert.equal(f.calls.length,0);assert.equal(f.actions.length,0);});
