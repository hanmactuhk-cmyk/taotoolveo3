const { spawn } = require('child_process');

function regularArguments(profile) {
  return ['--user-data-dir=' + profile, '--new-window', 'https://flow.google.com/'];
}

async function openRegularProfile(browser, store, account, launch = spawn) {
  if (await browser.isOpen(account)) {
    throw new Error('Đóng phiên điều khiển của hồ sơ này trước khi mở Chrome thường.');
  }
  const executable = browser.constructor.findBrowser();
  if (!executable) throw new Error('Không tìm thấy Chrome trên máy.');
  const profile = store.profileDir(account);
  await new Promise((resolve, reject) => {
    const child = launch(executable, regularArguments(profile), {
      detached: true, stdio: 'ignore', windowsHide: false
    });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  Object.assign(account, {
    LoginStarted: true, LoginMode: true, Port: 0, BrowserId: '',
    Status: 'Đã mở Chrome thường; đăng nhập và tạo trực tiếp trong hồ sơ này'
  });
  store.save();
  return { success: true, method: 'regular-chrome', profile };
}

module.exports = { regularArguments, openRegularProfile };
