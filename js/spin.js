/* ============================================================
   spin.js — Spin power calculation + requestAnimationFrame
   animation with cancellation support.
   ============================================================ */
(function (global) {
  "use strict";

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* Cubic easing: accelerates at the start, decelerates smoothly at the end. */
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  var Spin = {
    /* Map the final charging percentage to rotations + duration. */
    calculate: function (strength, sectorSize) {
      strength = clamp(strength, 1, 100);
      var rotations;
      if (strength <= 25) {
        rotations = lerp(2, 4, (strength - 1) / 24);
      } else if (strength <= 50) {
        rotations = lerp(5, 8, (strength - 26) / 24);
      } else if (strength <= 75) {
        rotations = lerp(9, 12, (strength - 51) / 24);
      } else {
        rotations = lerp(13, 20, (strength - 76) / 24);
      }

      // Stronger spins take longer.
      var duration = 2200 + strength * 38; // 2.2s -> 6.0s

      // A small offset keeps the wheel from stopping exactly on a boundary.
      var sector = sectorSize || 60;
      var offset = (Math.random() - 0.5) * sector * 0.7;

      return {
        rotations: rotations,
        duration: duration,
        degrees: rotations * 360 + offset,
        offset: offset
      };
    }
  };

  class Animator {
    constructor() {
      this.rafId = null;
      this.active = false;
    }

    spin(options) {
      this.cancel();
      var self = this;
      var from = options.from;
      var to = options.to;
      var duration = options.duration;
      var onUpdate = options.onUpdate || function () {};
      var onComplete = options.onComplete || function () {};
      var startTime = performance.now();
      this.active = true;

      function frame(now) {
        if (!self.active) return;
        var t = clamp((now - startTime) / duration, 0, 1);
        var eased = easeInOutCubic(t);
        var current = from + (to - from) * eased;
        onUpdate(current, t);

        if (t < 1) {
          self.rafId = requestAnimationFrame(frame);
        } else {
          self.active = false;
          self.rafId = null;
          onUpdate(to, 1);
          onComplete();
        }
      }

      this.rafId = requestAnimationFrame(frame);
    }

    cancel() {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.active = false;
    }
  }

  global.Spin = Spin;
  global.Animator = Animator;
})(window);
