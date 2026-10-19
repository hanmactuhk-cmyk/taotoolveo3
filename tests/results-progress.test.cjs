const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../flow-bridge.js'),'utf8');
function fixture({kind='image',label='flower',percent=null,ready=true,noSource=false}={}) {
  const media={tagName:'IMG',complete:true,naturalWidth:1024,getAttribute:n=>n==='src'&&!noSource?'https://flow.google.com/asb/fixture':null};
  const bar={getAttribute:n=>n==='aria-valuenow'?String(percent):null};
  const card={getAttribute:n=>n==='aria-label'?label:null,getClientRects:()=>[{}],cloneNode:()=>({innerText:percent===null?'':percent+'%',querySelectorAll:()=>[]}),
    querySelector(selector){
      if(/error|loading|progress-tile/.test(selector)) return selector.includes('progressbar')&&percent!==null?bar:null;
      if(selector==='flow-video-tile,video')return kind==='video'?{}:null;
      if(selector==='flow-image-tile,img.image,img[data-result],.generated-image')return kind==='image'?{}:null;
      if(selector.includes('thumbnail')||selector.includes('img.image'))return ready?media:null;
      return null;
    },querySelectorAll:selector=>selector==='[role="progressbar"]'&&percent!==null?[bar]:[]};
  const context=vm.createContext({window:{},document:{querySelectorAll:s=>s==='flow-grid-tile-container'?[card]:[]},location:{hostname:'flow.google.com',pathname:'/project/fixture',href:'https://flow.google.com/project/fixture'},getComputedStyle:()=>({visibility:'visible'}),setTimeout:fn=>fn(),WeakMap,Set,Map,Math,Number,JSON});
  return {context,card,run:request=>vm.runInContext(source.replace('__FLOWDESK_REQUEST__',JSON.stringify(request)),context)};
}
test('image result without data-asset-id is discovered by its real Flow card',async()=>{const f=fixture();const r=await f.run({action:'listResults'});assert.equal(r.ok,true);assert.equal(r.data.assets[0].kind,'image');assert(r.data.assets[0].fingerprint);});
test('video thumbnail becomes downloadable without a video src or mouse hover',async()=>{const f=fixture({kind:'video'});const r=await f.run({action:'jobStatus',kind:'video',prompt:'flower'});assert.equal(r.data.assets.length,1);assert.equal(r.data.progress,100);});
test('baseline result is excluded from a new generation',async()=>{const f=fixture();const baseline=await f.run({action:'mediaBaseline'});const r=await f.run({action:'jobStatus',kind:'image',prompt:'flower',baselineCards:baseline.data.cards});assert.equal(r.data.assets.length,0);assert.equal(r.data.progress,null);});
test('actual zero and intermediate percentages are returned instead of fabricated progress',async()=>{for(const percent of [0,37,82]){const f=fixture({ready:false,percent});const r=await f.run({action:'jobStatus',kind:'image',prompt:'flower'});assert.equal(r.data.progress,percent);assert.equal(r.data.assets.length,0);}});
test('unrelated cards are never assigned to the current job',async()=>{const f=fixture({label:'another prompt'});const r=await f.run({action:'jobStatus',kind:'image',prompt:'flower'});assert.equal(r.data.assets.length,0);});
test('new result after acknowledged submission can use the title assigned by Flow',async()=>{const f=fixture({label:'Flow summarized title'});f.context.window.__flowdeskSubmission={prompt:'flower'};const r=await f.run({action:'jobStatus',kind:'image',prompt:'flower'});assert.equal(r.data.assets.length,1);});
test('two video cards without public media URLs have independent download identities',async()=>{const f=fixture({kind:'video',noSource:true}),other=fixture({kind:'video',noSource:true});f.context.document.querySelectorAll=s=>s==='flow-grid-tile-container'?[f.card,other.card]:[];const r=await f.run({action:'listResults'});assert.equal(r.data.assets.length,2);assert.notEqual(r.data.assets[0].fingerprint,r.data.assets[1].fingerprint);});
test('Flow error toast is returned immediately with its original lines',async()=>{const f=fixture({ready:false});const message='Không thể tạo video.\nVui lòng thử lại sau.';const query=f.context.document.querySelectorAll;f.context.document.querySelectorAll=s=>s==='[role="alert"],mat-snack-bar-container'?[{innerText:message,getClientRects:()=>[{}]}]:query(s);const r=await f.run({action:'jobStatus',kind:'video',prompt:'flower'});assert.equal(r.data.error,message);});
