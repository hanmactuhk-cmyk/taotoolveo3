// HTTP cache only: never clear cookies, localStorage, IndexedDB or account data.
async function clearHttpCache(client) {
  await client.call('Network.clearBrowserCache', {});
}
module.exports = { clearHttpCache };
