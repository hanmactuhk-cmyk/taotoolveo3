const fs = require('fs');
const path = require('path');

function logRoot(store) { return path.join(store.root || store.data.OutputFolder, 'logs'); }
function jobLogPath(store, id) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id || '')) throw new Error('Mã job không hợp lệ.');
  return path.join(logRoot(store), 'jobs', id + '.log');
}
function appendJobLog(store, job, stage, message, level = 'info') {
  const file = jobLogPath(store, job.Id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = `${new Date().toISOString()} [${job.ExecutionId || job.Id}] [${job.AccountId || 'auto'}] [${stage}] ${level.toUpperCase()} ${message}\n`;
  fs.appendFileSync(file, line);
  job.LogFile = file;
  if (level === 'error') fs.appendFileSync(path.join(logRoot(store), 'errors.log'), `[Job ${job.Id}] ` + line);
  return file;
}
function readLogFile(file) {
  if (!fs.existsSync(file)) return { path: file, text: 'Chưa có nhật ký.' };
  const text = fs.readFileSync(file, 'utf8');
  return { path: file, text: text.slice(-256 * 1024) };
}
module.exports = { appendJobLog, jobLogPath, readLogFile, logRoot };
