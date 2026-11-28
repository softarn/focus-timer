/* Map keydown events to Pomodoro actions without relying on the DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PomodoroShortcuts = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function actionFor(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return null;

    var target = event.target;
    var tagName = target && target.tagName && target.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' ||
        (target && target.isContentEditable)) return null;

    switch (event.key) {
      case ' ': return tagName === 'button' || tagName === 'summary' ? null : 'toggle';
      case 'r':
      case 'R': return 'reset';
      case 's':
      case 'S': return 'settings';
      case '?': return 'help';
      default: return null;
    }
  }

  return { actionFor: actionFor };
});
