const crypto = require('crypto');

function syncDrafts(store, payload) {
  const { kind, model, ratio, count, mode, accountId } = payload;
  if (!['image', 'video'].includes(kind) || !Array.isArray(payload.prompts)) throw new Error('Danh sách prompt không hợp lệ.');
  const references = payload.references || [];
  const values = payload.samePrompt && references.length && payload.prompts.length
    ? references.map(() => payload.prompts.join('\n\n')) : payload.prompts;
  const drafts = store.data.Queue.filter(job => job.Kind === kind && job.AutoDraft && !job.Submitted && job.State === 'Hàng đợi');
  values.forEach((prompt, index) => {
    const selected = payload.samePrompt && references.length ? [references[index]] : [...references];
    let job = drafts[index];
    if (!job) {
      job = { Id: 'job_' + crypto.randomUUID(), Kind: kind, State: 'Hàng đợi', Note: 'Bản nháp tự động',
        Folder: '', Progress: null, Results: [], Submitted: false, AutoDraft: true, Attempts: [],
        StartImage: null, EndImage: null, References: selected, UseGlobalReferences: true };
      store.data.Queue.push(job);
    }
    Object.assign(job, { Prompt: String(prompt).trim(), Model: model, Ratio: ratio, Count: count,
      Mode: kind === 'video' && (job.StartImage || job.EndImage) ? 'Văn bản / Khung hình → Video' : mode,
      AccountId: !accountId || accountId === 'auto' ? '' : accountId });
    if (job.UseGlobalReferences !== false) job.References = selected;
  });
  for (const extra of drafts.slice(values.length)) store.data.Queue.splice(store.data.Queue.indexOf(extra), 1);
  store.save(); return store.data.Queue;
}

module.exports = { syncDrafts };
