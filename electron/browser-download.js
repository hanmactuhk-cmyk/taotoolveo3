const fs = require('fs');
const path = require('path');
const locks = new Map();

async function serialized(key, work) {
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  locks.set(key, current);
  try { return await current; }
  finally { if (locks.get(key) === current) locks.delete(key); }
}

function videoSize(buffer) {
  let found = null;
  const walk = (start, end) => {
    for (let offset = start; offset + 8 <= end;) {
      let size = buffer.readUInt32BE(offset), header = 8;
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      if (size === 1) { if (offset + 16 > end) break; const big = buffer.readBigUInt64BE(offset + 8); if (big > BigInt(Number.MAX_SAFE_INTEGER)) break; size = Number(big); header = 16; }
      if (size === 0) size = end - offset;
      if (size < header || offset + size > end) break;
      if (type === 'tkhd' && size >= 84) {
        const width = buffer.readUInt32BE(offset + size - 8) / 65536;
        const height = buffer.readUInt32BE(offset + size - 4) / 65536;
        if (width > 0 && height > 0 && (!found || width * height > found.width * found.height)) found = { width, height };
      }
      if (type === 'moov' || type === 'trak') walk(offset + header, offset + size);
      offset += size;
    }
  };
  walk(0, buffer.length); return found;
}

function validateFile(file, kind, require1080 = true) {
  const size = fs.statSync(file).size;
  if (!size) throw new Error('Chrome tải về tệp rỗng.');
  const bytes = fs.readFileSync(file);
  if (kind === 'video') {
    if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error('Tệp tải về không phải video MP4.');
    const dimensions = videoSize(bytes);
    if (require1080 && (!dimensions || Math.min(dimensions.width, dimensions.height) < 1080)) {
      throw new Error('Tệp Flow trả về chưa đạt 1080p; không đánh dấu tải hoàn tất.');
    }
    return { extension: '.mp4', bytes: size, ...dimensions };
  }
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return { extension: '.png', bytes: size };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { extension: '.jpg', bytes: size };
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return { extension: '.webp', bytes: size };
  throw new Error('Tệp tải về không phải PNG, JPEG hoặc WebP hợp lệ.');
}

const videoResolution = account => String(account?.Plan).toLowerCase() === 'free' ? '720p' : '1080p';

async function downloadBrowserAsset({ page, browserAddress, asset, destination, resolution = '1080p', onProgress = () => {}, timeoutMs = 10 * 60 * 1000, createClient }) {
  if (!['image', 'video'].includes(asset.kind)) throw new Error('Loại tệp không hợp lệ.');
  return serialized(browserAddress, async () => {
    const browser = createClient ? createClient() : new (require('./cdp-client'))();
    const folder = path.resolve(path.dirname(destination));
    fs.mkdirSync(folder, { recursive: true });
    let guid, contextId, configured = false, complete = false;
    try {
      await browser.connect(browserAddress);
      const tree = await page.call('Page.getFrameTree');
      const frameId = tree.frameTree.frame.id;
      const info = await page.call('Target.getTargetInfo');
      contextId = info.targetInfo && info.targetInfo.browserContextId;
      const context = contextId ? { browserContextId: contextId } : {};
      await browser.call('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: folder, eventsEnabled: true, ...context });
      configured = true;
      const started = Date.now();
      await page.bridge({ action: 'openAssetDownload', assetKey: asset.key, assetFingerprint: asset.fingerprint, kind: asset.kind, resolution });
      let checkedAt = 0;
      while (Date.now() - started < timeoutMs) {
        if (!guid) {
          const begin = browser.events.find(event => event.method === 'Browser.downloadWillBegin' && event.params.frameId === frameId);
          if (begin) {
            if (!/^[A-Za-z0-9-]{1,128}$/.test(begin.params.guid || '')) throw new Error('Chrome trả mã tải tệp không hợp lệ.');
            guid = begin.params.guid;
          }
        }
        if (!guid && Date.now() - checkedAt >= 1000) {
          checkedAt = Date.now();
          const flow = await page.bridge({ action: 'downloadStatus', assetKey: asset.key });
          if (flow && flow.error) { const error = new Error(flow.error); error.code = 'FLOW_DOWNLOAD_ERROR'; throw error; }
        }
        if (guid) {
          const updates = browser.events.filter(event => event.method === 'Browser.downloadProgress' && event.params.guid === guid);
          const status = updates[updates.length - 1]?.params;
          if (status) {
            const percent = status.totalBytes > 0 ? Math.min(100, Math.round(status.receivedBytes * 100 / status.totalBytes)) : null;
            onProgress({ percent, receivedBytes: status.receivedBytes, totalBytes: status.totalBytes });
            if (status.state === 'canceled') throw new Error('Chrome đã hủy tải tệp.');
            if (status.state === 'completed') {
              complete = true;
              const downloaded = path.join(folder, guid);
              const metadata = validateFile(downloaded, asset.kind, resolution !== '720p');
              if (asset.kind === 'video' && resolution === '720p' && (!metadata.width || Math.min(metadata.width, metadata.height) < 720)) throw new Error('Tệp Flow trả về chưa đạt 720p.');
              let target = path.join(folder, path.basename(destination, path.extname(destination)) + metadata.extension);
              for (let index = 1; fs.existsSync(target); index++) target = path.join(folder, path.basename(destination, path.extname(destination)) + '_' + index + metadata.extension);
              fs.renameSync(downloaded, target);
              return { path: target, ...metadata };
            }
          }
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw new Error('Hết thời gian chờ Flow chuẩn bị hoặc Chrome tải tệp; kiểm tra trình duyệt trước khi tải lại.');
    } finally {
      if (guid && !complete) try { await browser.call('Browser.cancelDownload', { guid, ...(contextId ? { browserContextId: contextId } : {}) }); } catch {}
      if (configured) try { await browser.call('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: false, ...(contextId ? { browserContextId: contextId } : {}) }); } catch {}
      browser.dispose();
    }
  });
}

function recoverableDownloadError(error) {
  const text = String(error?.message || '');
  if (/captcha|unusual|hoạt động bất thường|đăng nhập|sign.?in|login|tín dụng|credits?|quota|hạn mức|giới hạn|bị chặn|blocked|denied|forbidden|permission|khóa|locked|\b40[13]\b/i.test(text)) return false;
  if (error?.code === 'FLOW_DOWNLOAD_ERROR') return true;
  return /1080|upscale|độ phân giải|tải|download|timed? ?out|hết thời gian|kết nối tải/i.test(text);
}

async function downloadWithRefresh(options) {
  const attempt = options.attemptDownload || downloadBrowserAsset;
  try { return await attempt(options); }
  catch (error) {
    options.onAttemptError?.(error, 1);
    if (options.asset.kind !== 'video' || !recoverableDownloadError(error)) throw error;
    options.onRetry?.(error);
    const page = options.page;
    await page.call('Page.enable', {});
    if (Array.isArray(page.events)) page.events = page.events.filter(event => event.method !== 'Page.loadEventFired');
    await page.call('Page.reload', { ignoreCache: false });
    if (page.waitForProtocolEvent) await page.waitForProtocolEvent('Page.loadEventFired', 30000);
    const deadline = Date.now() + (options.refreshWaitMs ?? 30000);
    let replacement;
    do {
      const listing = await page.bridge({ action: 'listResults' });
      const sameKind = (listing.assets || []).filter(asset => asset.kind === options.asset.kind);
      const exact = sameKind.filter(asset => asset.fingerprint && asset.fingerprint === options.asset.fingerprint);
      const byLabel = sameKind.filter(asset => asset.label === options.asset.label);
      if (exact.length === 1) replacement = exact[0];
      else if (byLabel.length === 1) replacement = byLabel[0];
      if (replacement) break;
      if (Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 300));
    } while (Date.now() < deadline);
    if (!replacement) throw new Error('Sau làm mới chưa xác định được đúng video cần tải; giữ nguyên job để kiểm tra.');
    await options.onRefreshed?.();
    try { const result = await attempt({ ...options, asset: replacement }); return { ...result, assetFingerprint: replacement.fingerprint }; }
    catch (second) { options.onAttemptError?.(second, 2); throw second; }
  }
}

module.exports = { videoResolution, downloadBrowserAsset, downloadWithRefresh, recoverableDownloadError, validateFile, videoSize, serialized };
