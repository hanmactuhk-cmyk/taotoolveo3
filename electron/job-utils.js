const crypto = require('crypto');

const activeStates = new Set(['Đang chạy', 'Đang gửi']);
const modelKey = value => String(value || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const isFlowUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'flow.google.com' ||
      (url.hostname === 'labs.google' && url.pathname.includes('/tools/flow')));
  } catch { return false; }
};

function resolveModel(models, desired) {
  const matches = models.filter(item => !item.disabled && modelKey(item.name) === modelKey(desired));
  if (matches.length !== 1) throw new Error(`Model "${desired}" không có hoặc bị khóa. Đồng bộ danh mục trước khi chạy.`);
  return matches[0].name;
}

function configuredFields(settings, job) {
  const desired = [job.Ratio, job.Count];
  const changes = [];
  for (const field of settings.fields || []) {
    const values = (field.options || []).filter(option => !option.disabled).map(option => option.name);
    for (const value of desired) if (values.includes(value)) changes.push({ name: field.name, value });
    if (job.Kind === 'video' && /Loại video|Video type/i.test(field.name)) {
      const ingredients = String(job.Mode || '').startsWith('Thành phần');
      const value = values.find(item => ingredients ? /Thành phần|Ingredients/i.test(item) : /Khung hình|Frames/i.test(item));
      if (!value) throw new Error('Flow chưa cung cấp loại video đã chọn.');
      changes.push({ name: field.name, value });
    }
  }
  for (const value of desired) if (!changes.some(field => field.value === value)) throw new Error(`Flow chưa cung cấp tùy chọn ${value}.`);
  return changes;
}

function jobImages(job) {
  const references = Array.isArray(job.References) ? job.References.filter(Boolean) : [];
  if (job.Kind === 'video' && !String(job.Mode || '').startsWith('Thành phần')) {
    if (references.length > 2) throw new Error('Khung hình chỉ dùng ảnh đầu/cuối; chọn Thành phần cho nhiều ảnh.');
    return [
      { slot: 'start', path: job.StartImage || references[0] },
      { slot: 'end', path: job.EndImage || references[1] }
    ].filter(item => item.path);
  }
  return references.map(path => ({ slot: 'reference', path }));
}

function requiredResults(job) {
  const match = /^x([1-4])$/.exec(job.Count || '');
  if (!match) throw new Error('Số kết quả phải là x1, x2, x3 hoặc x4.');
  return Number(match[1]);
}

function verifyAccount(account, cost) {
  if (!account.Email || !['Free', 'Plus', 'Pro', 'Ultra'].includes(account.Plan)) throw new Error('Chưa xác minh email/gói tài khoản từ Flow.');
  if (!Number.isInteger(account.Credits) || account.Credits < 0) throw new Error('Chưa đọc được tín dụng từ Flow.');
  if (!Number.isInteger(cost) || cost < 0) throw new Error('Chưa đọc được chi phí cấu hình từ Flow.');
  if (account.Credits < cost) throw new Error(`Không đủ tín dụng: còn ${account.Credits}, cần ${cost}.`);
}

function resetJob(job) {
  job.Attempts = [...(job.Attempts || []), {
    ExecutionId: job.ExecutionId || job.Id, AccountId: job.AccountId,
    Prompt: job.SentPrompt ?? job.Prompt, State: job.State, Note: job.Note,
    Url: job.Url, Folder: job.Folder, Results: [...(job.Results || [])]
  }];
  Object.assign(job, { ExecutionId: crypto.randomUUID(), Submitted: false, SentPrompt: null,
    State: 'Hàng đợi', Note: 'Tạo lại trên cùng job', Progress: null, Results: [],
    Baseline: [], BaselineCards: [], Url: '', Folder: '', AutoDraft: false });
  return job;
}

module.exports = { activeStates, isFlowUrl, modelKey, resolveModel, configuredFields,
  jobImages, requiredResults, verifyAccount, resetJob };
