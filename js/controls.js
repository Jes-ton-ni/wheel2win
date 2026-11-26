/* ============================================================
   controls.js — All user input: wheel dragging, hold-to-charge
   button, and manual rotation controls. Uses Pointer Events.
   ============================================================ */
(function (global) {
  "use strict";

  function shortestDelta(target, start) {
    var d = (target - start) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }

  class Controls {
    constructor(app, elements) {
      this.app = app;
      this.el = elements;
      this.drag = null;
      this.sliderTimer = null;
      this.chargeSource = null;

      this._setupWheelDrag();
      this._setupHoldButton();
      this._setupRotationControls();
    }

    /* ---------- A. Mouse / touch dragging of the wheel ---------- */
    _setupWheelDrag() {
      var stage = this.el.wheelStage;
      var app = this.app;

      stage.addEventListener("pointerdown", function (e) {
        if (!app.canManual()) return;
        if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
        e.preventDefault();
        var rect = stage.getBoundingClientRect();
        var angle = Math.atan2(e.clientY - (rect.top + rect.height / 2),
                               e.clientX - (rect.left + rect.width / 2)) * 180 / Math.PI;
        this.drag = { pointerId: e.pointerId, startAngle: angle, startRotation: app.wheel.rotation };
        app.beginManual();
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        this.el.dragHint.classList.add("hidden");
      }.bind(this));

      stage.addEventListener("pointermove", function (e) {
        if (!this.drag || e.pointerId !== this.drag.pointerId || !app.canManual()) return;
        e.preventDefault();
        var rect = stage.getBoundingClientRect();
        var angle = Math.atan2(e.clientY - (rect.top + rect.height / 2),
                               e.clientX - (rect.left + rect.width / 2)) * 180 / Math.PI;
        var delta = shortestDelta(angle, this.drag.startAngle);
        app.setRotation(this.drag.startRotation + delta);
      }.bind(this));

      var endDrag = function (e) {
        if (!this.drag || (e && e.pointerId !== this.drag.pointerId)) return;
        this.drag = null;
        app.endManual();
      }.bind(this);

      stage.addEventListener("pointerup", endDrag);
      stage.addEventListener("pointercancel", endDrag);
      stage.addEventListener("lostpointercapture", endDrag);
      stage.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    }

    /* ---------- B. Hold-to-charge button ---------- */
    _setupHoldButton() {
      var btn = this.el.holdBtn;
      var app = this.app;

      btn.addEventListener("pointerdown", function (e) {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (!app.canCharge() || this.chargeSource !== null) return;
        e.preventDefault();
        this.chargeSource = "pointer:" + e.pointerId;
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        app.beginCharge();
      }.bind(this));

      var releasePointer = function (e) {
        if (!this.chargeSource || this.chargeSource !== "pointer:" + e.pointerId) return;
        e.preventDefault();
        this.chargeSource = null;
        app.endCharge();
      }.bind(this);

      btn.addEventListener("pointerup", releasePointer);
      btn.addEventListener("pointercancel", releasePointer);
      btn.addEventListener("lostpointercapture", releasePointer);

      // Backup: if the browser swallows the pointer event outside the button.
      global.addEventListener("pointerup", function (e) {
        if (this.chargeSource === "pointer:" + e.pointerId) {
          this.chargeSource = null;
          app.endCharge();
        }
      }.bind(this));

      btn.addEventListener("contextmenu", function (e) { e.preventDefault(); });

      btn.addEventListener("keydown", function (e) {
        if (e.key !== " " && e.key !== "Enter" && e.code !== "Space") return;
        e.preventDefault();
        if (e.repeat) return;
        if (!app.canCharge() || this.chargeSource !== null) return;
        this.chargeSource = "keyboard";
        app.beginCharge();
      }.bind(this));

      btn.addEventListener("keyup", function (e) {
        if (e.key !== " " && e.key !== "Enter" && e.code !== "Space") return;
        e.preventDefault();
        if (this.chargeSource !== "keyboard") return;
        this.chargeSource = null;
        app.endCharge();
      }.bind(this));

      btn.addEventListener("blur", function () {
        if (this.chargeSource === "keyboard") {
          this.chargeSource = null;
          app.endCharge();
        }
      }.bind(this));
    }

    /* ---------- C. Slider + nudge buttons ---------- */
    _setupRotationControls() {
      var app = this.app;
      var slider = this.el.rotationSlider;

      slider.addEventListener("input", function () {
        app.beginManual();
        app.setRotation(parseFloat(slider.value));
        clearTimeout(this.sliderTimer);
        this.sliderTimer = setTimeout(function () { app.endManual(); }, 220);
      }.bind(this));

      slider.addEventListener("change", function () {
        clearTimeout(this.sliderTimer);
        this.sliderTimer = setTimeout(function () { app.endManual(); }, 60);
      }.bind(this));

      var nudge = function (amount) {
        return function () {
          if (!app.canManual()) return;
          app.beginManual();
          app.nudge(amount);
          app.endManual();
        };
      };

      this.el.nudgeDown15.addEventListener("click", nudge(-15));
      this.el.nudgeDown1.addEventListener("click", nudge(-1));
      this.el.nudgeUp1.addEventListener("click", nudge(1));
      this.el.nudgeUp15.addEventListener("click", nudge(15));
      this.el.resetPositionBtn.addEventListener("click", function () {
        if (!app.canManual()) return;
        app.beginManual();
        app.resetPosition();
        app.endManual();
      });
    }
  }

  global.Controls = Controls;
})(window);
