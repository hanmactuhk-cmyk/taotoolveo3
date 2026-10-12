const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { mediaUrl, downloadMedia } = require('../electron/media-download');

function responseRequest(status, headers, contents) {
  return (url, options, callback) => {
    const request = new EventEmitter(); request.destroy = error => request.emit('error', error);
    process.nextTick(() => {
      const response = Readable.from(contents.length ? [Buffer.from(contents)] : []);
      response.statusCode = status; response.headers = headers; response.complete = true;
      callback(response);
    });
    return request;
  };
}

test('rejects non-Google, insecure and credential-bearing media URLs', () => {
  for (const url of ['https://evil.test/x', 'http://storage.googleapis.com/x', 'https://user:pass@storage.googleapis.com/x']) assert.throws(() => mediaUrl(url));
});
test('HTTP errors, HTML and empty media never become result files', async () => {
  const root = fs.mkdtempSync(path.join(__dirname, '.media-'));
  for (const [status, type, body] of [[403, 'image/png', 'bad'], [200, 'text/html', 'login'], [200, 'image/png', '']]) {
    const target = path.join(root, 'result.png');
    await assert.rejects(downloadMedia('https://storage.googleapis.com/test', target, 'image', responseRequest(status, { 'content-type': type }, body)));
    assert.equal(fs.existsSync(target), false);
  }
});
test('successful media is closed and atomically renamed with its actual extension', async () => {
  const root = fs.mkdtempSync(path.join(__dirname, '.media-'));
  const saved = await downloadMedia('https://storage.googleapis.com/test', path.join(root, 'result.png'), 'image', responseRequest(200, { 'content-type': 'image/jpeg' }, 'fixture bytes'));
  assert.equal(path.extname(saved), '.jpg'); assert.equal(fs.readFileSync(saved, 'utf8'), 'fixture bytes');
  assert.equal(fs.existsSync(saved + '.part'), false);
});
test('redirect to a non-Google origin is rejected before following it', async () => {
  await assert.rejects(downloadMedia('https://storage.googleapis.com/test', 'unused.png', 'image', responseRequest(302, { location: 'https://evil.test/file' }, '')), /Google/);
});
