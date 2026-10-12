async function checkAccount(browser, store, account, log = () => {}, updated = () => {}) {
  account.Status = 'Đang kiểm tra tài khoản...';
  updated(account);
  let client;
  try {
    // BrowserId is for Target/Browser commands. Read DOM only through a page target.
    client = await browser.connectFlowTab(account);
    client.trace = log;
    await client.call('Page.enable', {});
    await client.call('Network.enable', {});
    const data = await client.bridge({ action: 'account' });
    if (!data || !data.email) throw new Error('Flow chưa trả email.');
    Object.assign(account, { Email: data.email, Plan: data.plan || 'Unknown', Credits: data.credits,
      Evidence: data.evidence || '', CheckedUtc: new Date().toISOString() });
    account.Status = account.Plan === 'Unknown' || !Number.isInteger(account.Credits)
      ? 'Đã đọc email; gói/credit chưa rõ' : 'Hoạt động — đã xác minh từ Flow';
    store.save();
    updated(account);
    log(`[Account] Đã kiểm tra ${account.Name} | ${account.Plan} | ${account.Credits ?? 'chưa rõ'} tín dụng`);
    return { success: true, account };
  } catch (error) {
    account.CheckedUtc = null;
    account.Status = 'Lỗi đọc: ' + error.message;
    store.save(); updated(account); throw error;
  } finally { if (client) client.dispose(); }
}

module.exports = { checkAccount };
