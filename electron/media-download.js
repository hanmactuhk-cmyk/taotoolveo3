const fs = require('fs');
const path = require('path');
const https = require('https');

function mediaUrl(value) {
  const url = new URL(value);
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password ||
      !(host.endsWith('.googleusercontent.com') || host.endsWith('.google.com') ||
        host.endsWith('.gstatic.com') || host === 'storage.googleapis.com')) {
    throw new Error('Kết quả không có URL media Google hợp lệ.');
  }
  return url;
}

function downloadMedia(value, destination, kind, request = https.get, redirects = 0) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = mediaUrl(value); } catch (error) { reject(error); return; }
    let req;
    try {
      req = request(url, { timeout: 30000 }, response => {
        const status = response.statusCode;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (redirects >= 3) { reject(new Error('Media chuyển hướng quá nhiều lần.')); return; }
          let redirected;
          try { redirected = mediaUrl(new URL(response.headers.location, url).href); }
          catch (error) { reject(error); return; }
          downloadMedia(redirected.href, destination, kind, request, redirects + 1).then(resolve, reject);
          return;
        }
        const type = String(response.headers['content-type'] || '').toLowerCase();
        if (status !== 200 || !(kind === 'video' ? type.startsWith('video/') : type.startsWith('image/'))) {
          response.resume(); reject(new Error(`Tải media không hợp lệ: HTTP ${status}, ${type || 'không có Content-Type'}.`)); return;
        }
        const ext = kind === 'video' ? '.mp4' : type.includes('jpeg') ? '.jpg' : type.includes('webp') ? '.webp' : '.png';
        const target = path.join(path.dirname(destination), path.basename(destination, path.extname(destination)) + ext);
        const temporary = target + '.part';
        const file = fs.createWriteStream(temporary);
        let bytes = 0;
        let settled = false;
        const fail = error => {
          if (settled) return;
          settled = true; response.destroy(); file.destroy();
          fs.rm(temporary, { force: true }, () => reject(error));
        };
        response.on('data', chunk => { bytes += chunk.length; });
        response.on('error', fail);
        response.on('aborted', () => fail(new Error('Kết nối tải media bị ngắt.')));
        file.on('error', fail);
        file.on('finish', () => file.close(() => {
          if (settled) return;
          if (!bytes || !response.complete) { fail(new Error('Tệp media rỗng hoặc chưa tải đủ.')); return; }
          fs.rename(temporary, target, error => {
            if (error) { fail(error); return; }
            settled = true; resolve(target);
          });
        }));
        response.pipe(file);
      });
      req.on('timeout', () => req.destroy(new Error('Hết thời gian tải media.')));
      req.on('error', reject);
    } catch (error) { reject(error); }
  });
}

module.exports = { mediaUrl, downloadMedia };
