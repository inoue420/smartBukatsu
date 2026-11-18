// react-native-youtube-iframe 2.4.1 sends JSON commands. The deployed iframe
// expects legacy strings for play/pause/mute, and neither bundled nor deployed
// HTML handles setPlaybackRate. Own these JSON commands without replacing the
// player or changing the remote source used for YouTube embedding.
const YOUTUBE_PLAYBACK_RATE_BRIDGE = `
(function () {
  if (window.__smartbukatsuPlaybackRateBridge) return;
  window.__smartbukatsuPlaybackRateBridge = true;
  var handled = new WeakSet();
  function receive(event) {
    try {
      var message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (!message || typeof message !== 'object') return;
      var method, args = [];
      switch (message.eventName) {
        case 'playVideo':
        case 'pauseVideo':
          method = message.eventName;
          break;
        case 'muteVideo': method = 'mute'; break;
        case 'unMuteVideo': method = 'unMute'; break;
        case 'setPlaybackRate':
          var rate = message.meta && message.meta.playbackRate;
          if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 2) return;
          method = 'setPlaybackRate';
          args = [rate];
          break;
        default: return;
      }
      if (!window.player || typeof window.player[method] !== 'function') return;
      // Capture before the page receiver, including when injected after load.
      // This also avoids duplicate calls if the remote HTML adopts JSON later.
      event.stopImmediatePropagation();
      if (handled.has(event)) return;
      handled.add(event);
      window.player[method].apply(window.player, args);
    } catch (_) {}
  }
  // iOS dispatches to window; Android versions can dispatch to document.
  window.addEventListener('message', receive, true);
  document.addEventListener('message', receive, true);
})();
true;
`;

module.exports = { YOUTUBE_PLAYBACK_RATE_BRIDGE };
