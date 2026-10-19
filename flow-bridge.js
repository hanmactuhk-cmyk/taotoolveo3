/* FlowDesk operates only on the visible Flow UI; no private service endpoints. */
(async function (request) {
  'use strict';
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const norm=s=>(s||'').replace(/\s+/g,' ').trim();
  const visible=e=>!!(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
  const list=(s,root=document)=>[...root.querySelectorAll(s)].filter(visible);
  const text=e=>{const target=e?.querySelector('.toggle-text,.item-text .label,.mdc-button__label')||e;if(!target)return '';const copy=target.cloneNode(true);copy.querySelectorAll('mat-icon,[aria-hidden="true"]').forEach(x=>x.remove());return norm(copy.textContent);};
  const label=e=>norm(e.getAttribute('aria-label')||text(e));
  const disabled=e=>e.disabled||e.getAttribute('aria-disabled')==='true';
  function one(items,message){if(items.length!==1)throw Error(message+' ('+items.length+')');return items[0];}
  function button(names,root=document){return one(list('button',root).filter(e=>names.includes(label(e))), 'Không xác định được nút '+names[0]);}
  async function wait(fn,message){for(let i=0;i<25;i++){const v=fn();if(v)return v;await sleep(200);}throw Error(message);}
  function tap(e){if(disabled(e))throw Error('Flow đã khóa lựa chọn: '+label(e));e.click();}
  function number(s){const m=norm(s).match(/(?:^|\s)(\d[\d.,\s]*)\s*(?:(?:AI|Google Flow)\s+)?(?:tín dụng|credits?)/i);if(!m)return null;const raw=m[1].replace(/[.,\s]/g,'');const n=Number(raw);return Number.isSafeInteger(n)&&n>=0?n:null;}
  function closeOverlays(){list('.cdk-overlay-backdrop').reverse().forEach(e=>e.click());if(settingsRoot()){const b=list('button.settings-trigger-button')[0];if(b)b.click();}const accountClose=list('button').find(e=>/^(Đóng bảng điều khiển tài khoản|Close account panel)$/i.test(label(e)));if(accountClose)accountClose.click();}
  function settingsRoot(){return list('flow-prompt-box-settings')[0];}
  async function ensureProject(){
    if(list('div.ProseMirror[contenteditable="true"]').length)return;
    if(/^\/project\//.test(location.pathname)){await wait(()=>list('div.ProseMirror[contenteditable="true"]').length,'Dự án chưa tải được ô prompt.');return;}
    closeOverlays();const create=one(list('button.new-project-button').length?list('button.new-project-button'):list('button').filter(e=>['Dự án mới','New project'].includes(label(e))),'Không tìm thấy nút Dự án mới');tap(create);
    for(let i=0;i<100;i++){if(list('div.ProseMirror[contenteditable="true"]').length)return;await sleep(200);}throw Error('Flow đã mở dự án nhưng chưa tải xong trình tạo.');
  }
  async function settings(){
    await ensureProject();
    if(!settingsRoot()){closeOverlays();tap(button(['Điều kiện kích hoạt cài đặt','Settings trigger','Settings']));}
    return await wait(settingsRoot,'Không mở được cài đặt Flow. Mở một dự án trước.');
  }
  const modeNames={image:['Hình ảnh','Image','Images'],video:['Video']};
  async function mode(kind){const root=await settings();const e=one(list('[role="radio"]',root).filter(x=>modeNames[kind].includes(text(x))),'Không xác định được chế độ');if(e.getAttribute('aria-checked')!=='true'){tap(e);await sleep(400);}return settingsRoot();}
  const modelNames=['Chọn nhóm mô hình','Select model family','Select model','Choose model family'];
  function modelButton(root){const byLabel=list('button',root).filter(e=>modelNames.includes(label(e)));if(byLabel.length===1)return byLabel[0];return one(list('button[aria-haspopup="menu"]',root),'Không xác định được bộ chọn model');}
  async function openModels(root){const b=modelButton(root);if(b.getAttribute('aria-expanded')!=='true')tap(b);await wait(()=>list('[role="menuitem"]').length,'Flow không trả danh mục model.');}
  function fields(root){return list('flow-toggles',root).map(group=>({name:group.getAttribute('aria-label')||'',options:list('[role="radio"]',group).map(e=>({name:text(e),selected:e.getAttribute('aria-checked')==='true',disabled:!!disabled(e)}))}));}
  function snapshot(root){
    const b=modelButton(root),copy=b.cloneNode(true);copy.querySelectorAll('mat-icon').forEach(e=>e.remove());
    const costText=list('flow-credit-cost-label',root).map(e=>norm(e.innerText)).join(' ');
    return {model:norm(copy.textContent),cost:number(costText),costText,fields:fields(root),url:location.href};
  }
  async function stableSnapshot(){const root=await settings();let previous='';for(let i=0;i<10;i++){const s=snapshot(root),key=JSON.stringify(s);if(previous===key)return s;previous=key;await sleep(350);}throw Error('Cài đặt/giá chưa ổn định; hãy thử kiểm tra lại.');}
  function promptEditor(){return one(list('div.ProseMirror[contenteditable="true"]'),'Không xác định được ô nhập prompt');}
  function promptText(){return (promptEditor().innerText||'').replace(/\r/g,'').trim();}
  function alertText(){return list('[role="alert"],mat-snack-bar-container').map(e=>norm(e.innerText)).join(' ').slice(0,500);}
  function generate(){return button(['Bắt đầu tạo','Start creating','Generate']);}
  function attachmentCount(slot){
    const frames=list('flow-ingredient-bar .frame-trigger');
    if(slot==='start'||slot==='end'){const frame=frames[slot==='start'?0:1];return frame?frame.querySelectorAll('img,flow-image-reference,flow-prompt-image').length:0;}
    return new Set(list('.ProseMirror img,flow-ingredient-bar img,flow-prompt-image,flow-image-reference')).size;
  }
  function securityError(){
    const errNodes = list('flow-error-tile .error-message, [role="alert"], mat-snack-bar-container, .error-message, [class*="error-message"]');
    return errNodes.map(text).find(t=>/hoạt động bất thường|unusual activity|sửa đổi trang|modify the page/i.test(t))||'';
  }
  function tileId(e){if(!window.__flowdeskTiles)window.__flowdeskTiles={map:new WeakMap(),next:0};const t=window.__flowdeskTiles;if(!t.map.has(e))t.map.set(e,'visible-tile-'+(++t.next));return t.map.get(e);}
  function resultCards(){const grid=list('flow-grid-tile-container');return grid.length?grid:list('flow-tile-container');}
  function cardSignature(card){const video=card.querySelector('video');return card.getAttribute('data-asset-id')||card.getAttribute('data-generation-id')||card.querySelector('[data-media-id]')?.getAttribute('data-media-id')||card.querySelector('flow-video-tile img.thumbnail,flow-image-tile img.image')?.getAttribute('src')||video?.getAttribute('poster')||video?.currentSrc||video?.getAttribute('src')||'';}
  function cardKind(card){return card.querySelector('flow-video-tile,video')?'video':card.querySelector('flow-image-tile,img.image,img[data-result],.generated-image')?'image':null;}
  function readyAsset(card){const kind=cardKind(card);const error=card.querySelector('flow-error-tile,.error-message');if(!kind||error||card.querySelector('flow-loading-tile,flow-progress-tile,[role="progressbar"]'))return null;const image=card.querySelector(kind==='video'?'flow-video-tile img.thumbnail,video':'flow-image-tile img.image,img[data-result],.generated-image');if(!image)return null;if(image.tagName==='IMG'&&(!image.complete||!image.naturalWidth))return null;const label=norm(card.getAttribute('aria-label')||card.querySelector('.footer-title')?.textContent||'');if(!window.__flowdeskFingerprints)window.__flowdeskFingerprints=new WeakMap();let stored=window.__flowdeskFingerprints.get(card);if(!stored||stored.kind!==kind||stored.label!==label){let hash=2166136261;for(const c of cardSignature(card)||label+':'+tileId(card)){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}stored={kind,label,fingerprint:(hash>>>0).toString(16)};window.__flowdeskFingerprints.set(card,stored);}return {key:tileId(card),...stored};}
  function cardProgress(card){const values=[];for(const e of card.querySelectorAll('[role="progressbar"]')){const raw=e.getAttribute('aria-valuenow');if(raw!==null&&Number.isFinite(Number(raw))&&Number(raw)>=0&&Number(raw)<=100)values.push(Number(raw));}const copy=card.cloneNode(true);copy.querySelectorAll('flow-tile-hover-footer,.prompt-text,.asset-prompt').forEach(e=>e.remove());const m=norm(copy.innerText||copy.textContent).match(/(?:^|\s)(\d{1,3}(?:\.\d+)?)\s*%/);if(m&&Number(m[1])<=100)values.push(Number(m[1]));return values.length?Math.min(...values):null;}
  try {
    const accountWidget=request.accountFrame&&((location.hostname==='ogs.google.com'&&/account/.test(location.pathname))||(location.hostname==='accounts.google.com'&&/SignOutOptions/.test(location.pathname)));
    if(location.hostname!=='flow.google.com'&&location.hostname!=='labs.google'&&!accountWidget)throw Error('Hãy hoàn tất đăng nhập Google rồi mở Flow.');
    if(request.action==='account'){
      await sleep(100);
      const accountHeader=list('.header-user-button,flow-header-user-icon')[0];
      const tierTexts=accountHeader?list('flow-user-tier-chip',accountHeader).map(e=>norm(e.textContent)):[];
      if(accountHeader&&!tierTexts.length)tierTexts.push(...list('span,div,button',accountHeader).filter(e=>e.children.length===0).map(e=>norm(e.textContent)));
      const headerBadge=['Ultra','Pro','Plus'].find(p=>tierTexts.some(t=>new RegExp('^(?:Google(?: AI)?\\s+|AI\\s+)?'+p+'$','i').test(t)));
      const headerPlan=headerBadge||(accountHeader?'Free':request.headerPlan||'Unknown');
      const emailPattern=/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;
      function findPanel(){
        if(accountWidget&&emailPattern.test(document.body.innerText)&&/(tín dụng|credits?)/i.test(document.body.innerText))return document.body;
        const dialogs=list('[role="dialog"],dialog').filter(e=>emailPattern.test(e.innerText||'')&&/(?:tín dụng|credits?|Đăng xuất khỏi|Sign out|Manage subscription)/i.test(e.innerText||''));
        const legacy=list('[role="dialog"]').filter(e=>/Cài đặt tài khoản|Account settings/i.test(e.getAttribute('aria-label')||''));
        if(dialogs.length===1)return dialogs[0];if(legacy.length===1)return legacy[0];
        const panels=[];
        for(const leaf of list('.user-email,span,p,a,div').filter(e=>e.children.length<=1&&emailPattern.test(norm(e.innerText)))){
          for(let parent=leaf.parentElement,depth=0;parent&&depth<7;parent=parent.parentElement,depth++){
            if(parent===document.body||parent.tagName==='MAIN')break;
            const t=norm(parent.innerText);if(/(?:Đăng xuất khỏi mọi tài khoản|Sign out of all accounts|Quản lý gói thuê bao|Manage subscription)/i.test(t)&&number(t)!==null){if(!panels.includes(parent))panels.push(parent);break;}
          }
        }
        return panels.length===1?panels[0]:null;
      }
      let panel=findPanel();
      if(!panel){
        let buttons=list('.header-user-button a[role="button"]');
        if(buttons.length===0)buttons=list('a[role="button"]').filter(e=>/^(Tài khoản Google|Google Account)[:\s]/i.test(label(e)));
        if(buttons.length===0)buttons=list('button,[role="button"]').filter(e=>/^(?:Thông tin về tài khoản|Account information|Account info)(?:$|[:\s])/i.test(label(e)));
        if(buttons.length===0)buttons=list('button,[role="button"]').filter(e=>e.querySelector('img[src*="googleusercontent.com"]')&&e.getBoundingClientRect().top<180);
        if(buttons.length!==1){
          throw Error('Không thấy nút tài khoản trong ứng dụng Flow. Hãy mở bảng tài khoản Google ở góc trên bên phải của Flow rồi bấm Làm mới.');
        }
        if(buttons[0].getAttribute('aria-expanded')!=='true')tap(buttons[0]);
        await sleep(700);panel=findPanel();
        if(!panel){const frames=list('iframe').filter(e=>e.getBoundingClientRect().width>150&&e.getBoundingClientRect().height>150&&!/RotateCookiesPage/.test(e.src||''));
          if(frames.length)return {ok:false,code:'ACCOUNT_FRAME_REQUIRED',headerPlan,frameUrls:frames.map(e=>e.src),error:'Đang đọc bảng Google trong khung tài khoản.'};
          panel=await wait(findPanel,'Đã mở bảng Google nhưng chưa đọc được nội dung email/tín dụng.');}
      }
      const creditEl=list('.credits-count',panel)[0]||list('a',panel).find(e=>/\d.*(?:tín dụng|credits?)/i.test(e.innerText));
      const creditText=norm(creditEl?.innerText)||norm(panel.innerText);
      const daily=list('.refresh-daily-label',panel).map(e=>norm(e.innerText)).join(' ')||(norm(panel.innerText).match(/[^.!\n]*(?:làm mới hằng ngày|làm mới hàng ngày|refresh(?:ed)? daily|refresh(?:es)? every day)[^.!\n]*/i)||[])[0]||'';
      const leaves=list('span,div',panel).filter(e=>e.children.length===0&&!e.closest('a,button,.upsell-link')).map(e=>norm(e.innerText));
      let plan=headerPlan,evidence=headerPlan==='Free'?'Không có nhãn gói cạnh avatar; xác minh email bên dưới':headerPlan!=='Unknown'?'Nhãn gói cạnh avatar: '+headerPlan:'Không có nhãn gói rõ ràng trong Flow';
      if(plan==='Unknown')for(const p of ['Ultra','Pro','Plus']){const hit=leaves.find(t=>new RegExp('^(?:Google(?: AI)?\\s+|AI\\s+)?'+p+'$','i').test(t));if(hit){plan=p;evidence=hit;break;}}
      if(plan==='Unknown'&&daily&&/hằng ngày|hàng ngày|daily|every day/i.test(daily)){plan='Free';evidence='Credit làm mới hằng ngày: '+daily;}
      const email=norm(panel.querySelector('.user-email')?.textContent)||((panel.innerText.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)||[])[0]||'');
      if(!email&&plan==='Free'){plan='Unknown';evidence='Chưa xác minh email đăng nhập.';}
      const result={email,plan,credits:number(creditText),evidence,creditText,checkedAt:new Date().toISOString()};
      const close=list('button',panel).find(e=>/Đóng bảng điều khiển tài khoản|Close account panel/i.test(label(e)));
      return {ok:true,data:result};
    }
    if(request.action==='newProject'){
      closeOverlays();tap(button(['Dự án mới','New project']));return {ok:true,data:{message:'Đã bấm tạo dự án. Chờ Flow mở dự án rồi đồng bộ model.'}};
    }
    if(request.action==='catalog'){
      const root=await mode(request.kind);await openModels(root);
      const models=list('[role="menuitem"]').map(e=>({name:text(e),disabled:!!disabled(e)}));
      if(!models.length)throw Error('Danh mục model trống.');
      closeOverlays();return {ok:true,data:{models}};
    }
    if(request.action==='configure'){
      let root=await mode(request.kind);
      if(request.model){
        await openModels(root);
        tap(one(list('[role="menuitem"]').filter(e=>text(e)===request.model),'Model không còn trong danh mục'));
        await sleep(400);
        if(list('[role="menuitem"]').length)throw Error('Model có tùy chọn con. Chọn biến thể trong Flow rồi bấm Đọc cài đặt hiện tại.');
      }
      root=await settings();
      for(const field of request.fields||[]){
        const group=one(list('flow-toggles',root).filter(e=>e.getAttribute('aria-label')===field.name),'Tùy chọn đã thay đổi: '+field.name);
        const e=one(list('[role="radio"]',group).filter(e=>text(e)===field.value),'Không tìm thấy giá trị: '+field.value);tap(e);await sleep(250);
      }
      const data=await stableSnapshot();closeOverlays();return {ok:true,data};
    }
    if(request.action==='settings') {const data=await stableSnapshot();closeOverlays();return {ok:true,data};}
    if(request.action==='prepareFill'){
      closeOverlays();await sleep(250);const e=promptEditor();e.scrollIntoView({block:'nearest'});const rect=e.getBoundingClientRect(),x=rect.left+Math.min(rect.width/2,30),y=rect.top+Math.min(rect.height/2,15);const hit=document.elementFromPoint(x,y);if(!hit||!(hit===e||e.contains(hit)))throw Error('Ô prompt bị bảng khác che.');return {ok:true,data:{x,y}};
    }
    if(request.action==='selectPrompt'){
      const editor=promptEditor();editor.focus();
      if(document.activeElement!==editor&&!editor.contains(document.activeElement))throw Error('Không thể đặt tiêu điểm vào đúng ô prompt.');
      const selection=getSelection();if(!selection)throw Error('Không chọn được nội dung ô prompt.');
      const range=document.createRange();range.selectNodeContents(editor);selection.removeAllRanges();selection.addRange(range);
      return {ok:true,data:{focused:true}};
    }
    if(request.action==='confirmFill'){
      await wait(()=>promptText()===request.prompt.replace(/\r/g,'').trim(),'Chrome đã nhập nhưng Flow chưa xác nhận prompt khớp.');return {ok:true,data:{confirmed:true}};
    }
    if(request.action==='fill'){
      closeOverlays();let error;
      for(let attempt=1;attempt<=3;attempt++){
        try{
          const el=promptEditor();el.focus();const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
          if(!document.execCommand('insertText',false,request.prompt))throw Error('Flow chưa nhận prompt.');
          await sleep(300);if(promptText()!==request.prompt.replace(/\r/g,'').trim())throw Error('Prompt chưa khớp.');
          return {ok:true,data:{attempts:attempt}};
        }catch(e){error=e;await sleep(attempt*300);}
      }throw error;
    }
    if(request.action==='upload'){
      closeOverlays();const pickerClose=list('button').filter(e=>label(e)==='Đóng'||label(e)==='Close');if(pickerClose.length===1)tap(pickerClose[0]);await sleep(200);
      if(request.slot==='start')tap(button(['Bắt đầu','Start']));
      else if(request.slot==='end')tap(button(['Kết thúc','End']));
      else tap(button(['Thêm thành phần vào ô nhập câu lệnh','Add ingredients to prompt','Add to prompt']));
      const upload=await wait(()=>list('button').find(e=>['Tải nội dung nghe nhìn lên','Upload media'].includes(label(e))),'Không thấy nút tải ảnh.');
      tap(upload);return {ok:true,data:{message:'Chọn ảnh trong hộp thoại của Flow. Hoàn tất cắt/chọn ảnh để ảnh xuất hiện trong ô prompt.'}};
    }
    if(request.action==='finishUpload'){
      const initial=request.initialCount;
      const finishNames=['Cắt và lưu','Crop and save','Lưu ảnh','Save image','Thêm vào câu lệnh','Add to prompt'];
      for(let i=0;i<360;i++){
        if(attachmentCount(request.slot)>initial)return {ok:true,data:{attached:true}};
        const candidates=list('button').filter(e=>finishNames.includes(label(e))&&!disabled(e));
        if(candidates.length===1){tap(candidates[0]);await sleep(700);}else await sleep(250);
      }
      throw Error('Ảnh đã gửi vào bộ chọn tệp nhưng chưa xác minh ảnh trong prompt. Hoàn tất cắt/thêm ảnh trong Flow rồi Kiểm tra Flow.');
    }
    if(request.action==='attachmentCount')return {ok:true,data:{count:attachmentCount(request.slot)}};
    if(request.action==='ready'){
      closeOverlays();if(securityError())throw Error(securityError());const e=generate();return {ok:true,data:{prompt:promptText(),enabled:!disabled(e),alert:alertText(),url:location.href}};
    }
    if(request.action==='verifyConfig'){
      const root=await settings();const selected=fields(root).flatMap(f=>f.options.filter(o=>o.selected).map(o=>o.name));
      for(const desired of [request.ratio,request.count])if(desired&&!selected.includes(desired))throw Error('Flow chưa xác nhận tùy chọn '+desired+'. Kiểm tra cấu hình trước khi gửi.');
      closeOverlays();return {ok:true,data:{selected}};
    }
    if(request.action==='mediaBaseline'){
      const cards=resultCards().map(tileId),signatures=resultCards().map(cardSignature).filter(Boolean);
      return {ok:true,data:{cards,signatures,urls:[...document.querySelectorAll('video,video source,img')].map(e=>e.currentSrc||e.src).filter(Boolean)}};
    }
    if(request.action==='jobStatus'){
      const target=norm(request.prompt),sent=window.__flowdeskSubmission;
      const candidates=resultCards().filter(e=>!(request.baselineCards||[]).includes(tileId(e))&&!(request.baselineSignatures||[]).includes(cardSignature(e)));
      const cards=candidates.filter(e=>norm(e.getAttribute('aria-label')||e.querySelector('[data-prompt]')?.getAttribute('data-prompt')||e.querySelector('.prompt-text,.asset-prompt')?.textContent)===target||(sent&&norm(sent.prompt)===target));
      const assets=[],progress=[];
      for(const card of cards){const error=card.querySelector('flow-error-tile .error-message,.error-message,[role="alert"]');if(error)return {ok:true,data:{assets:[],urls:[],error:norm(error.innerText)}};const asset=readyAsset(card);if(asset&&asset.kind===request.kind){assets.push(asset);progress.push(100);}else{const n=cardProgress(card);if(n!==null)progress.push(n);}}
      return {ok:true,data:{assets,urls:[],progress:progress.length?Math.min(...progress):null,message:assets.length?'Flow đã tạo kết quả; chuẩn bị tải tệp.':cards.length?'Đang tạo trên Flow.':'Chờ thẻ mới của lần gửi; chưa ghép kết quả cũ.'}};
    }
    if(request.action==='listResults'){
      return {ok:true,data:{assets:resultCards().map(readyAsset).filter(Boolean),url:location.href}};
    }
    if(request.action==='scrollResults'){
      const card=resultCards()[0];let viewport=card?.parentElement;
      while(viewport&&!(viewport.scrollHeight>viewport.clientHeight&&/auto|scroll/.test(getComputedStyle(viewport).overflowY)))viewport=viewport.parentElement;
      if(viewport){const previous=viewport.scrollTop;viewport.scrollTop+=Math.max(200,viewport.clientHeight*0.8);if(viewport.scrollTop===previous)viewport.scrollTop=0;}
      return {ok:true,data:{scrolled:!!viewport}};
    }
    if(request.action==='openAssetDownload'){
      closeOverlays();await sleep(150);
      const card=one(resultCards().filter(e=>tileId(e)===request.assetKey),'Không tìm thấy đúng thẻ kết quả cần tải');
      if(request.assetFingerprint&&readyAsset(card)?.fingerprint!==request.assetFingerprint)throw Error('Thẻ kết quả đã thay đổi; đọc lại danh sách trước khi tải.');
      if(cardKind(card)!==request.kind)throw Error('Loại tệp của thẻ không khớp.');
      const more=one([...card.querySelectorAll('button')].filter(e=>/^(Tuỳ chọn khác|Tùy chọn khác|More options)$/i.test(label(e))),'Không tìm thấy menu của thẻ');tap(more);
      const entry=await wait(()=>list('[role="menuitem"]').find(e=>/^(Tải xuống|Download)$/i.test(text(e))),'Flow chưa mở menu tải xuống.');
      const submenu=entry.getAttribute('aria-haspopup')==='menu';tap(entry);
      if(request.kind==='video'){
        const option=await wait(()=>list('[role="menuitem"]').find(e=>/^1080p$/i.test(text(e))),'Flow không có lựa chọn tải 1080p cho video này.');
        if(disabled(option))throw Error('Flow khóa bản 1080p cho video/tài khoản này.');
        if(/\d+\s*(tín dụng|credits)/i.test(option.innerText))throw Error('Flow yêu cầu tín dụng để tải 1080p; cần bạn xác nhận trong trình duyệt.');
        tap(option);return {ok:true,data:{requested:true,resolution:'1080p'}};
      }
      if(submenu){const option=await wait(()=>list('[role="menuitem"]').find(e=>/^(Kích thước gốc|Kích thước gốc|Original(?: size)?|1K)$/i.test(text(e))),'Flow chưa cung cấp lựa chọn tải ảnh gốc.');tap(option);}
      return {ok:true,data:{requested:true,resolution:'original'}};
    }
    if(request.action==='clearCaptchaSession'){
      try { localStorage.removeItem('_grecaptcha'); } catch(e) {}
      try {
        for (const k of Object.keys(sessionStorage)) {
          if (k.startsWith('flowdesk:')) sessionStorage.removeItem(k);
        }
      } catch(e) {}
      closeOverlays();
      return {ok:true,data:{cleared:true}};
    }
    if(request.action==='prepareSubmit'){
      closeOverlays();
      await sleep(250);
      try { localStorage.removeItem('_grecaptcha'); } catch(e) {}
      if(securityError())throw Error(securityError());
      if(promptText()!==request.prompt.replace(/\r/g,'').trim())throw Error('Prompt trong Flow đã thay đổi; hãy chuẩn bị lại.');
      if(alertText())throw Error('Flow đang báo: '+alertText());
      const e=generate();if(disabled(e))throw Error('Nút tạo đang bị khóa. Hoàn tất tải ảnh/cài đặt hoặc kiểm tra hạn mức.');
      const key='flowdesk:'+request.jobId;if(sessionStorage.getItem(key))throw Error('Lệnh này đã được gửi; không gửi trùng.');
      e.scrollIntoView({block:'nearest'});const rect=e.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2;
      const hit=document.elementFromPoint(x,y);if(!hit||!(hit===e||e.contains(hit)))throw Error('Nút tạo đang bị bảng khác che. Đóng bảng đó trước khi gửi.');
      window.__flowdeskSubmission={jobId:request.jobId,tiles:list('flow-tile-container').map(tileId),prompt:request.prompt};
      sessionStorage.setItem(key,'attempted');
      return {ok:true,data:{x,y}};
    }
    if(request.action==='confirmSubmit'){
      const sent=window.__flowdeskSubmission;if(!sent||sent.jobId!==request.jobId)throw Error('Mất trạng thái lần gửi; kiểm tra Flow trước khi thử lại.');
      for(let i=0;i<40;i++){
        const tiles=list('flow-tile-container').filter(e=>!sent.tiles.includes(tileId(e)));
        if(tiles.length){sessionStorage.setItem('flowdesk:'+request.jobId,'submitted');return {ok:true,data:{submitted:true,message:'Flow đã hiển thị thẻ mới sau lần gửi.'}};}
        if(promptText()===''){sessionStorage.setItem('flowdesk:'+request.jobId,'submitted');return {ok:true,data:{submitted:true,message:'Flow đã nhận và xóa prompt khỏi ô nhập.'}};}
        if(alertText())throw Error('Flow đang báo: '+alertText());await sleep(250);
      }
      throw Error('Chưa xác nhận Flow nhận lệnh: prompt vẫn trong ô nhập và không có thẻ mới. Đã bấm một lần; không tự gửi lại.');
    }
    if(request.action==='status'){return {ok:true,data:{alert:alertText(),url:location.href,message:'Kiểm tra thẻ kết quả trong Flow; không tự suy đoán đã hoàn tất.'}};}
    throw Error('Thao tác không được hỗ trợ.');
  } catch(error) {return {ok:false,error:error.message};}
})(__FLOWDESK_REQUEST__)
