const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { downloadMedia } = require('./media-download');
const { downloadBrowserAsset } = require('./browser-download');
const { clearHttpCache } = require('./browser-cache');
const { activeStates, resolveModel, configuredFields, jobImages, requiredResults, verifyAccount, resetJob } = require('./job-utils');

class JobRunner {
  constructor(store, browserManager, onEvent, options = {}) {
    this.store = store; this.browser = browserManager; this.onEvent = onEvent || (() => {});
    this.running = false; this.paused = false; this.stopped = false;
    this.cooldowns = new Map(); this.activeWorkers = 0; this.workers = new Map(); this.pendingRetries = new Set();
    this.monitorTimeout = options.monitorTimeout ?? 15 * 60 * 1000;
    this.pollInterval = options.pollInterval ?? 2000;
    this.sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.lastOptions = {};
    this.cachePending = new Set();
  }
  log(msg) { this.onEvent('log', `${new Date().toLocaleTimeString()} ${msg}`); }
  status() { this.onEvent('runner-status', { running: this.running, paused: this.paused, stopping: this.stopped && this.running, active: this.activeWorkers }); }
  updateQueue() { this.onEvent('queue-updated', this.store.data.Queue); this.status(); }
  accountBusy(id) { return this.store.data.Queue.some(job => job.AccountId === id && activeStates.has(job.State)); }
  runQueue(options = {}) {
    if (this.running) return this.runPromise;
    const concurrent = Math.min(4, Math.max(1, Number.parseInt(options.concurrent, 10) || 1));
    this.lastOptions = { ...options, concurrent };
    this.running = true; this.paused = false; this.stopped = false; this.status();
    this.runPromise = this.drain(this.lastOptions); return this.runPromise;
  }
  async drain(options) {
    const only = options.only ? new Set(options.only) : null;
    this.log(`[JobRunner] Bắt đầu; tối đa ${options.concurrent} job song song.`);
    try {
      while (!this.stopped) {
        if (this.paused) { await this.sleep(100); continue; }
        const job = this.store.data.Queue.find(item => item.State === 'Hàng đợi' && !this.workers.has(item.Id) &&
          (!options.kind || item.Kind === options.kind) && (!only || only.has(item.Id)));
        if (!job) {
          if (!this.workers.size) break;
          await Promise.race([...this.workers.values(), this.sleep(100)]); continue;
        }
        if (this.workers.size >= options.concurrent) { await Promise.race([...this.workers.values(), this.sleep(100)]); continue; }
        const eligible = this.store.data.Accounts.filter(account => account.LoginStarted && account.Enabled &&
          (job.Kind === 'image' ? account.Images : account.Videos) && (!job.AccountId || job.AccountId === 'auto' || job.AccountId === account.Id));
        const account = eligible.find(item => !this.isCoolingDown(item.Id)) || eligible[0];
        if (!account) { job.State = 'Lỗi'; job.Note = 'Không có tài khoản đủ quyền cho tác vụ này.'; this.store.save(); this.updateQueue(); continue; }
        const task = this.processJob(job, account).catch(error => {
          job.State = job.Submitted ? 'Cần kiểm tra' : 'Lỗi'; job.Note = error.message; this.log(`[Job ${job.Id}] ${error.message}`);
        }).finally(() => {
          this.workers.delete(job.Id);
          if (this.pendingRetries.delete(job.Id)) { resetJob(job); try { this.store.save(); } catch (error) { this.log(error.message); } }
          this.updateQueue();
        });
        this.workers.set(job.Id, task);
      }
    } finally {
      await Promise.allSettled([...this.workers.values()]);
      this.running = false; this.paused = false; this.updateQueue();
      this.log('[JobRunner] Đã dừng điều phối; các lần gửi không được tự phát lại.');
    }
  }
  pause() { this.paused = !this.paused; this.status(); return this.paused; }
  stop() { this.stopped = true; this.paused = false; this.status(); this.log('Dừng nhận job mới; tiếp tục theo dõi lệnh đã gửi.'); }
  isCoolingDown(id) { return (this.cooldowns.get(id) || 0) > Date.now(); }
  setCooldown(id, seconds = 10) { this.cooldowns.set(id, Date.now() + seconds * 1000); }

  async processJob(job, account) {
    this.activeWorkers++;
    Object.assign(job, { AutoDraft: false, SentPrompt: job.Prompt, State: 'Đang chạy', AccountId: account.Id, Note: 'Đang kết nối đúng tab Chrome...' });
    if (!job.ExecutionId) job.ExecutionId = crypto.randomUUID();
    let cdp;
    try {
      this.store.save(); this.updateQueue();
      if (!String(job.SentPrompt || '').trim()) throw new Error('Prompt trống.');
      const required = requiredResults(job); const images = jobImages(job);
      for (const image of images) if (!fs.existsSync(image.path) || !fs.statSync(image.path).isFile()) throw new Error('Không tìm thấy ảnh đã chọn: ' + path.basename(image.path));
      if (this.isCoolingDown(account.Id)) await this.sleep(this.cooldowns.get(account.Id) - Date.now());
      if (this.stopped) throw new Error('Đã dừng trước khi gửi.');
      cdp = await this.connectJobTab(account, job.Url); cdp.trace = message => this.log(`[Job ${job.Id}][CDP] ${message}`);
      await cdp.enableDiagnostics();
      const data = await cdp.bridge({ action: 'account' });
      if (!data || !data.email) throw new Error('Flow chưa trả email tài khoản.');
      Object.assign(account, { Email: data.email, Plan: data.plan, Credits: data.credits, Evidence: data.evidence || '', CheckedUtc: new Date().toISOString(), Status: 'Đã đọc từ Flow' });
      const verified = { ...account }; this.store.save(); this.onEvent('account-updated', account);
      const catalog = await cdp.bridge({ action: 'catalog', kind: job.Kind });
      job.Url = (await cdp.bridge({ action: 'status' })).url; this.store.save();
      job.Model = resolveModel(catalog.models || [], job.Model);
      const settings = await cdp.bridge({ action: 'configure', kind: job.Kind, model: job.Model });
      const config = await cdp.bridge({ action: 'configure', kind: job.Kind, fields: configuredFields(settings, job) });
      await cdp.bridge({ action: 'verifyConfig', ratio: job.Ratio, count: job.Count }); verifyAccount(verified, config.cost);
      await cdp.bridge({ action: 'fill', prompt: job.SentPrompt });
      for (const image of images) { this.log(`[Job ${job.Id}] Tải ${image.slot}: ${path.basename(image.path)}`); await cdp.uploadImage(image.path, image.slot); }
      for (const slot of [...new Set(images.map(image => image.slot))]) {
        const attached = await cdp.bridge({ action: 'attachmentCount', slot });
        if (attached.count < images.filter(image => image.slot === slot).length) throw new Error(`Chưa xác minh đủ ảnh ở ô ${slot}.`);
      }
      const ready = await cdp.bridge({ action: 'ready' });
      if (ready.prompt !== job.SentPrompt.replace(/\r/g, '').trim()) throw new Error('Prompt trong Flow đã thay đổi.');
      if (!ready.enabled || ready.alert) throw new Error(ready.alert || 'Flow đang khóa nút tạo.');
      if (this.stopped) throw new Error('Đã dừng trước khi gửi.');
      const baseline = await cdp.bridge({ action: 'mediaBaseline' });
      Object.assign(job, { Baseline: baseline.urls || [], BaselineCards: baseline.cards || [], BaselineSignatures: baseline.signatures || [],
        Folder: path.join(this.store.data.OutputFolder, job.Kind, job.Id, job.ExecutionId), Url: ready.url, State: 'Đang gửi', Submitted: true });
      fs.mkdirSync(job.Folder, { recursive: true });
      this.store.save(); this.updateQueue();
      await cdp.bridge({ action: 'submit', jobId: job.ExecutionId, prompt: job.SentPrompt });
      job.State = 'Đang chạy'; job.Note = 'Flow đã nhận lệnh; đang theo dõi kết quả.';
      this.store.save(); this.updateQueue(); await this.monitorJob(cdp, job, required);
      this.cachePending.add(account.Id);
    } catch (error) {
      job.State = job.Submitted ? 'Cần kiểm tra' : 'Lỗi'; job.Note = error.message; this.log(`[Job ${job.Id}] ${error.message}`);
      if (/hoạt động bất thường|unusual activity/i.test(error.message)) {
        this.log(`[Job ${job.Id}] Phát hiện reCAPTCHA / hoạt động bất thường. Đang tự động dọn _grecaptcha và tải lại tab...`);
        try {
          if (cdp && cdp.clearCaptchaSession) {
            await cdp.clearCaptchaSession();
            await cdp.call('Page.reload', { ignoreCache: false });
          }
        } catch (clearErr) {
          this.log(`[Job ${job.Id}] Lỗi tự động dọn captcha: ${clearErr.message}`);
        }
        this.stop();
      }
      if (this.lastOptions.closeBrowserOnError === true) try {
        const another = this.store.data.Queue.some(item => item.Id !== job.Id && item.AccountId === account.Id && activeStates.has(item.State));
        if (another && this.browser.closeJobTab) await this.browser.closeJobTab(account, job.Url); else await this.browser.close(account);
      } catch (closeError) { this.log('Không đóng được Chrome: ' + closeError.message); }
    } finally {
      const another = this.store.data.Queue.some(item => item.Id !== job.Id && item.AccountId === account.Id && activeStates.has(item.State));
      if (cdp && !another && this.cachePending.delete(account.Id)) {
        try { await clearHttpCache(cdp); this.log(`[Cache] Đã dọn HTTP cache của ${account.Name}; giữ cookie và tài khoản.`); }
        catch (error) { this.log('[Cache] Chưa dọn được HTTP cache: ' + error.message); }
      }
      if (cdp) cdp.dispose();
      const seconds = String(this.lastOptions.delay || '').startsWith('5') ? 5 : String(this.lastOptions.delay || '').startsWith('20') ? 20 : 10;
      this.setCooldown(account.Id, seconds); this.activeWorkers--; this.store.save(); this.updateQueue();
    }
  }
  connectJobTab(account, projectUrl) { return this.browser.connectFlowTab(account, { projectUrl: projectUrl || '', newTab: true }); }

  async monitorJob(cdp, job, required = requiredResults(job)) {
    const deadline = Date.now() + this.monitorTimeout; const downloaded = new Map();
    while (Date.now() < deadline) {
      const status = await cdp.bridge({ action: 'jobStatus', prompt: job.SentPrompt, baseline: job.Baseline || [], baselineCards: job.BaselineCards || [], baselineSignatures: job.BaselineSignatures || [], kind: job.Kind });
      if (status.error) throw new Error(status.error);
      if (Number.isFinite(status.progress)) job.Progress = status.progress;
      if (status.message) job.Note = status.message;
      this.store.save(); this.updateQueue();
      for (const asset of status.assets || []) if (!downloaded.has('asset:' + (asset.fingerprint || asset.key))) {
        const account = this.store.data.Accounts.find(item => item.Id === job.AccountId);
        if (!account || !account.BrowserId) throw new Error('Mất phiên Chrome dùng tải kết quả.');
        const target = path.join(job.Folder, `result_${downloaded.size + 1}${job.Kind === 'video' ? '_1080p.mp4' : '.png'}`);
        job.Note = job.Kind === 'video' ? 'Đang chuẩn bị và tải video 1080p từ Flow...' : 'Đang tải ảnh gốc từ Flow...';
        const saved = await this.downloadAsset(cdp, account, asset, target, progress => {
          job.DownloadProgress = progress.percent; this.updateQueue();
        });
        downloaded.set('asset:' + (asset.fingerprint || asset.key), saved.path); job.Results = [...downloaded.values()];
        job.ResultMetadata = [...(job.ResultMetadata || []), saved]; job.DownloadProgress = 100;
        this.store.save(); this.updateQueue();
      }
      for (const url of [...new Set(status.urls || [])]) if (!downloaded.has(url)) {
        if (job.Kind === 'video') throw new Error('Chưa xác minh được thẻ tải 1080p; không tải nhầm video xem trước.');
        const target = path.join(job.Folder, `result_${downloaded.size + 1}${job.Kind === 'video' ? '.mp4' : '.png'}`);
        const saved = await this.downloadFile(url, target, job.Kind); downloaded.set(url, saved); job.Results = [...downloaded.values()];
      }
      if (downloaded.size >= required) {
        job.State = 'Hoàn tất'; job.Progress = 100; job.Note = `Đã tải ${downloaded.size} tệp kết quả thật.`;
        this.store.save(); this.updateQueue(); return;
      }
      if (Array.isArray(status.assets) && status.assets.length) await cdp.bridge({ action: 'scrollResults' });
      this.store.save(); this.updateQueue(); await this.sleep(this.pollInterval);
    }
    throw new Error('Quá thời gian theo dõi; kiểm tra Flow trước khi gửi lại.');
  }
  downloadFile(url, destination, kind = 'video') { return downloadMedia(url, destination, kind); }
  downloadAsset(page, account, asset, destination, onProgress) { return downloadBrowserAsset({ page, browserAddress: account.BrowserId, asset, destination, onProgress }); }
  retryJob(id) {
    const job = this.store.data.Queue.find(item => item.Id === id);
    if (!job) throw new Error('Không tìm thấy job.');
    if (this.workers.has(id) || activeStates.has(job.State)) { this.pendingRetries.add(id); job.Note = 'Đã yêu cầu tạo lại; chờ lần hiện tại kết thúc.'; }
    else resetJob(job);
    this.store.save(); this.updateQueue(); return job;
  }
}
module.exports = JobRunner;
