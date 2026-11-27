/* UI wiring for the Pomodoro timer. Sound and notification failures are
 * swallowed so they can never break the countdown. */
(function () {
  'use strict';

  var timer = PomodoroTimer.createTimer();
  var els = {
    phase: document.getElementById('phase'),
    countdown: document.getElementById('countdown'),
    toggle: document.getElementById('toggle'),
    reset: document.getElementById('reset'),
    status: document.getElementById('status')
  };
  var LABELS = { focus: 'Focus', break: 'Break' };
  var intervalId = null;
  var audioCtx = null;

  function render() {
    var s = timer.getState();
    els.phase.textContent = LABELS[s.phase];
    els.phase.setAttribute('data-phase', s.phase);
    els.countdown.textContent = s.display;
    els.toggle.textContent = s.running ? 'Pause' : 'Start';
    document.title = s.display + ' – ' + LABELS[s.phase];
  }

  function chime() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t0 = audioCtx.currentTime;
      [659.25, 880].forEach(function (freq, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        var t = t0 + i * 0.25;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.15, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 1);
      });
    } catch (e) { /* sound is optional */ }
  }

  function notify(text) {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Focus Timer', { body: text });
      }
    } catch (e) { /* notification is optional */ }
  }

  function requestNotifyPermission() {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        var p = Notification.requestPermission();
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) { /* ignore */ }
  }

  function onPhaseEnd() {
    var s = timer.getState();
    var text = s.phase === 'break' ? 'Focus complete. Time for a break.' : 'Break over. Time to focus.';
    els.status.textContent = text;
    chime();
    notify(text);
  }

  function loop() {
    var switches = timer.tick(Date.now());
    render();
    if (switches > 0) onPhaseEnd();
  }

  function startLoop() {
    if (intervalId === null) intervalId = setInterval(loop, 250);
  }
  function stopLoop() {
    if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
  }

  els.toggle.addEventListener('click', function () {
    if (timer.getState().running) {
      timer.pause(Date.now());
      stopLoop();
    } else {
      // Permission and audio unlock both need a user gesture.
      requestNotifyPermission();
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC && !audioCtx) audioCtx = new AC();
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      } catch (e) { /* ignore */ }
      timer.start(Date.now());
      startLoop();
    }
    render();
  });

  els.reset.addEventListener('click', function () {
    timer.reset();
    stopLoop();
    els.status.textContent = '';
    render();
  });

  render();
})();
