const status = document.querySelector('#status');
async function action(message) {
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (result.error) throw new Error(result.error);
    status.textContent = message.type === 'stop' ? 'Paused. Any question already sent may still finish.' : 'Connected. Use Sonnet 5 Medium in the dedicated Claude tab.';
    if (message.type === 'pair') document.querySelector('#token').value = '';
  } catch (error) { status.textContent = error.message; }
}
document.querySelector('#pair').onclick = () => action({ type: 'pair', token: document.querySelector('#token').value.trim() });
document.querySelector('#start').onclick = () => action({ type: 'start' });
document.querySelector('#stop').onclick = () => action({ type: 'stop' });
chrome.runtime.sendMessage({ type: 'status' }).then(r => {
  status.textContent = r.error || (r.enabled ? 'Running. Keep the dedicated Sonnet tab open.' : 'Paired. Press Start Claude tab.');
}).catch(() => {});
