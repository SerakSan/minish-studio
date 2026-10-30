(() => {
  'use strict';
  let installPrompt = null;
  const button = document.getElementById('installAppBtn');
  if (button) {
    button.hidden = true;
    button.addEventListener('click', async () => {
      if (!installPrompt) return;
      await installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      button.hidden = true;
    });
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); installPrompt = event;
    if (button) button.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null; if (button) button.hidden = true;
  });
  // A downloaded folder also works directly, without a service worker.
  if (location.protocol !== 'https:') return;
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js', { scope: './' }).catch(() => {});
  });
})();
