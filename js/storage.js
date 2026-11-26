/* ============================================================
   storage.js — Safe localStorage wrapper with JSON serialization
   ============================================================ */
(function (global) {
  "use strict";

  var PREFIX = "spinTheWheel.";

  var Storage = {
    get: function (key, fallback) {
      try {
        var raw = global.localStorage.getItem(PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },

    set: function (key, value) {
      try {
        global.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch (e) {
        /* Storage may be unavailable (private mode / disabled). Fail silently. */
      }
    },

    remove: function (key) {
      try {
        global.localStorage.removeItem(PREFIX + key);
      } catch (e) { /* ignore */ }
    }
  };

  global.Storage = Storage;
})(window);
