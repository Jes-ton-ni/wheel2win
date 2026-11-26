/* ============================================================
   app.js — Application orchestration: state machine, charging,
   entry/history management, sound, confetti, and UI wiring.
   ============================================================ */
(function (global) {
  "use strict";

  var State = {
    IDLE: "IDLE",
    MANUAL_POSITIONING: "MANUAL_POSITIONING",
    CHARGING: "CHARGING",
    SPINNING: "SPINNING",
    RESULT: "RESULT"
  };

  var DEFAULT_ENTRIES = [
    { name: "Pizza",  color: "#FF6B6B" },
    { name: "Sushi",  color: "#4ECDC4" },
    { name: "Tacos",  color: "#FFE66D" },
    { name: "Burger", color: "#A78BFA" },
    { name: "Pasta",  color: "#38BDF8" },
    { name: "Salad",  color: "#F472B6" }
  ];

  var POWER_LEVELS = [
    { max: 25,  label: "Low Power",    color: "#38BDF8" },
    { max: 50,  label: "Medium Power", color: "#34D399" },
    { max: 75,  label: "High Power",   color: "#FB923C" },
    { max: 100, label: "Maximum Power",color: "#FB7185" }
  ];

  function powerInfo(strength) {
    for (var i = 0; i < POWER_LEVELS.length; i++) {
      if (strength <= POWER_LEVELS[i].max) return POWER_LEVELS[i];
    }
    return POWER_LEVELS[POWER_LEVELS.length - 1];
  }

  function cloneDefaults() {
    return DEFAULT_ENTRIES.map(function (e) { return { name: e.name, color: e.color }; });
  }

  function shuffle(array) {
    var a = array.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  class App {
    constructor() {
      this.el = this._collectElements();
      this.state = State.IDLE;

      // --- persisted data ---
      this.entries = this._loadEntries();
      this.history = Storage.get("history", []);
      if (!Array.isArray(this.history)) this.history = [];
      this.settings = Storage.get("settings", { sound: true, chargeSeconds: 3, controlsVisible: false, entriesVisible: true });
      if (!this.settings || typeof this.settings !== "object") {
        this.settings = { sound: true, chargeSeconds: 3, controlsVisible: false, entriesVisible: true };
      }
      if (typeof this.settings.sound !== "boolean") this.settings.sound = true;
      if (typeof this.settings.chargeSeconds !== "number") this.settings.chargeSeconds = 3;
      if (typeof this.settings.controlsVisible !== "boolean") this.settings.controlsVisible = false;
      if (typeof this.settings.entriesVisible !== "boolean") this.settings.entriesVisible = true;

      // --- core objects ---
      this.wheel = new Wheel(this.el.wheelCanvas, this.el.wheelStage, this.entries);
      this.animator = new Animator();
      this.charge = { rafId: null, cycleStart: 0, strength: 0, maxTimer: null };
      this.audioCtx = null;
      this.spinSound = null;
      this.toastTimer = null;

      this.controls = new Controls(this, {
        wheelStage: this.el.wheelStage,
        dragHint: this.el.dragHint,
        holdBtn: this.el.holdBtn,
        rotationSlider: this.el.rotationSlider,
        nudgeDown15: this.el.nudgeDown15,
        nudgeDown1: this.el.nudgeDown1,
        nudgeUp1: this.el.nudgeUp1,
        nudgeUp15: this.el.nudgeUp15,
        resetPositionBtn: this.el.resetPositionBtn
      });

      this._bindUI();
      this.renderEntries();
      this.renderHistory();
      this.syncSettingsUI();
      this.applyControlsVisibility(this.settings.controlsVisible);
      this.applyEntriesVisibility(this.settings.entriesVisible);
      this.syncRotationUI();
      this.updateStrengthUI(0);
    }

    _collectElements() {
      var ids = [
        "wheelStage", "wheelCanvas", "dragHint", "entryCountBadge", "entryCountMini",
        "strengthCard", "strengthPercent", "powerMeterFill",
        "holdBtn", "rotationSlider", "angleValue",
        "nudgeDown15", "nudgeDown1", "nudgeUp1", "nudgeUp15", "resetPositionBtn",
        "entriesInput", "colorRow",
        "shuffleEntriesBtn", "randomizeColorsBtn", "resetEntriesBtn", "clearEntriesBtn",
        "soundToggle", "soundLabel", "chargeSpeedSlider", "chargeSpeedValue",
        "resetWheelBtn", "fullscreenBtn", "fullscreenBtn2",
        "controlsToggleBtn", "controlsToggleLabel", "sideColumn",
        "entriesToggleBtn", "entriesToggleLabel", "entriesPanel", "wheelRow",
        "historyList", "historyCount", "clearHistoryBtn",
        "winnerModal", "modalBackdrop", "modalCloseX", "winnerName",
        "closeModalBtn", "spinAgainBtn", "removeWinnerBtn", "confettiCanvas", "toast"
      ];
      var el = {};
      ids.forEach(function (id) { el[id] = document.getElementById(id); });
      return el;
    }

    /* ================= STATE MACHINE ================= */
    setState(next) {
      var allowed = {
        IDLE:               [State.MANUAL_POSITIONING, State.CHARGING],
        MANUAL_POSITIONING: [State.IDLE],
        CHARGING:           [State.SPINNING, State.IDLE],
        SPINNING:           [State.RESULT, State.IDLE],
        RESULT:             [State.IDLE, State.CHARGING]
      };
      if (next !== this.state && (allowed[this.state] || []).indexOf(next) === -1) {
        if (global.console && console.warn) {
          console.warn("Blocked invalid state transition: " + this.state + " -> " + next);
        }
        return false;
      }
      this.state = next;
      document.body.dataset.state = next;
      this.setBusy(next === State.SPINNING || next === State.CHARGING);
      return true;
    }

    setBusy(busy) {
      document.body.classList.toggle("is-busy", busy);
      // Keep the button visually normal; state checks still block charging while busy.
      this.el.holdBtn.setAttribute("aria-disabled", busy ? "true" : "false");
      this.el.entriesInput.disabled = busy;
      var swatches = this.el.colorRow.querySelectorAll(".color-swatch");
      for (var i = 0; i < swatches.length; i++) swatches[i].disabled = busy;
    }

    canManual() {
      return this.state === State.IDLE || this.state === State.MANUAL_POSITIONING;
    }

    canCharge() {
      return this.state === State.IDLE;
    }

    beginManual() {
      if (this.canManual() && this.state === State.IDLE) this.setState(State.MANUAL_POSITIONING);
    }

    endManual() {
      if (this.state === State.MANUAL_POSITIONING) this.setState(State.IDLE);
    }

    /* ================= MANUAL ROTATION ================= */
    setRotation(deg) {
      this.wheel.setRotation(deg);
      this.syncRotationUI();
      this.el.dragHint.classList.add("hidden");
    }

    nudge(delta) {
      this.setRotation(this.wheel.rotation + delta);
      this.playPress();
    }

    resetPosition() {
      this.setRotation(0);
      this.toast("Wheel position reset");
    }

    syncRotationUI() {
      var normalized = Wheel.normalize(this.wheel.rotation);
      var rounded = Math.round(normalized);
      this.el.angleValue.textContent = rounded + "°";
      this.el.rotationSlider.value = rounded;
    }

    /* ================= HOLD-TO-CHARGE ================= */
    beginCharge() {
      if (!this.canCharge()) return;
      if (!this.setState(State.CHARGING)) return;

      this.playPress();
      clearTimeout(this.charge.maxTimer);
      this.charge.cycleStart = performance.now();
      this.charge.strength = 0;
      this.el.holdBtn.classList.add("charging");
      this.el.holdBtn.classList.remove("maxed");
      this.el.strengthCard.classList.remove("maxed");
      this.updateStrengthUI(0);

      var self = this;

      function tick(now) {
        if (self.state !== State.CHARGING) return;

        var duration = self.settings.chargeSeconds * 1000;
        self.charge.strength = Math.min(100, ((now - self.charge.cycleStart) / duration) * 100);
        self.updateStrengthUI(self.charge.strength);

        if (self.charge.strength >= 100) {
          // Flash the 100% effect, but restart at 0% immediately — no hold/delay.
          self.el.strengthCard.classList.add("maxed");
          self.el.holdBtn.classList.add("maxed");
          self.playMax();
          clearTimeout(self.charge.maxTimer);
          self.charge.maxTimer = setTimeout(function () {
            self.el.strengthCard.classList.remove("maxed");
            self.el.holdBtn.classList.remove("maxed");
          }, 280);

          self.charge.cycleStart = now;
          self.charge.strength = 0;
          self.updateStrengthUI(0);
        }
        self.charge.rafId = requestAnimationFrame(tick);
      }
      this.charge.rafId = requestAnimationFrame(tick);
    }

    endCharge() {
      if (this.state !== State.CHARGING) return;
      if (this.charge.rafId !== null) cancelAnimationFrame(this.charge.rafId);
      this.charge.rafId = null;
      clearTimeout(this.charge.maxTimer);

      var strength = Math.max(1, Math.round(this.charge.strength));
      this.el.holdBtn.classList.remove("charging", "maxed");
      this.el.strengthCard.classList.remove("maxed");
      this.updateStrengthUI(strength); // freeze the released value during the spin
      // The button itself returns to its resting look as soon as it is released.
      this.el.holdBtn.style.setProperty("--glow", "0");
      this.startSpin(strength);
    }

    updateStrengthUI(strength) {
      var value = Math.round(strength);
      var info = powerInfo(strength);
      this.el.strengthPercent.textContent = value + "%";
      this.el.powerMeterFill.style.height = value + "%";
      this.el.strengthCard.style.setProperty("--power-color", info.color);
      this.el.holdBtn.style.setProperty("--glow", (strength / 100).toFixed(3));
    }

    /* ================= SPINNING ================= */
    startSpin(strength) {
      if (!this.setState(State.SPINNING)) return;

      if (this.entries.length < 2) {
        this.toast("Add at least two entries to spin");
        this.setState(State.IDLE);
        this.updateStrengthUI(0);
        return;
      }

      var sector = 360 / this.entries.length;
      var plan = Spin.calculate(strength, sector);
      var startRotation = this.wheel.rotation;
      var targetRotation = startRotation + plan.degrees;
      var self = this;

      this.startSpinSound();

      this.animator.spin({
        from: startRotation,
        to: targetRotation,
        duration: plan.duration,
        onUpdate: function (degrees, t) {
          self.wheel.setRotation(degrees);
          self.syncRotationUI();
          self.updateSpinSound(t);
        },
        onComplete: function () {
          self.wheel.setRotation(Wheel.normalize(targetRotation));
          self.syncRotationUI();
          self.stopSpinSound();
          self.finishSpin(strength, plan, targetRotation);
        }
      });
    }

    finishSpin(strength, plan, finalRotation) {
      // Winner is ALWAYS derived from the wheel's actual final angle.
      var index = this.wheel.winnerIndex();
      var entry = this.entries[index];
      var record = {
        winner: entry.name,
        color: entry.color,
        time: new Date().toISOString(),
        strength: strength,
        rotations: Math.round(plan.rotations * 100) / 100
      };

      this.history.unshift(record);
      Storage.set("history", this.history);
      this.renderHistory();

      this.setState(State.RESULT);
      this.showWinner(entry, index);
      this.playWin();
      this.launchConfetti();

      // No buffer: the meter is back at 0% the instant the spin finishes.
      this.updateStrengthUI(0);
    }

    /* ================= WINNER MODAL ================= */
    showWinner(entry, index) {
      this.winnerEntryIndex = index;
      this.el.removeWinnerBtn.textContent = 'Remove “' + entry.name + '” from wheel';
      this.el.winnerName.textContent = entry.name;
      this.el.winnerModal.classList.add("open");
    }

    closeModal() {
      this.el.winnerModal.classList.remove("open");
      if (this.state === State.RESULT) this.setState(State.IDLE);
    }

    /* Remove the winning entry from the wheel while keeping the spin in history. */
    removeWinner() {
      var index = this.winnerEntryIndex;
      if (typeof index !== "number" || index < 0 || index >= this.entries.length) return;
      var removed = this.entries.splice(index, 1)[0];
      this.winnerEntryIndex = null;
      this.saveEntries();
      this.renderEntries();
      this.wheel.setEntries(this.entries);
      this.closeModal();
      this.toast('Removed "' + removed.name + '" from the wheel');
    }

    /* ================= ENTRY MANAGEMENT ================= */
    _loadEntries() {
      var stored = Storage.get("entries", null);
      if (!Array.isArray(stored)) return cloneDefaults();
      // An intentionally empty wheel must stay empty after a refresh.
      return stored.filter(function (e) {
        return e && typeof e.name === "string" && typeof e.color === "string";
      });
    }

    saveEntries() {
      Storage.set("entries", this.entries);
    }

    /* The textarea is the single source for entry names: one entry per line. */
    renderEntries() {
      this.el.entriesInput.value = this.entries.map(function (e) { return e.name; }).join("\n");
      this.renderColorRow();
      this.updateEntryCounts();
    }

    updateEntryCounts() {
      var count = this.entries.length;
      this.el.entryCountBadge.textContent = count + (count === 1 ? " entry" : " entries");
      this.el.entryCountMini.textContent = count + (count === 1 ? " item" : " items");
    }

    renderColorRow() {
      var row = this.el.colorRow;
      row.innerHTML = "";
      var self = this;
      if (!this.entries.length) {
        row.innerHTML = '<span class="color-hint">Colors appear here once you add entries</span>';
        return;
      }
      this.entries.forEach(function (entry, index) {
        var swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "color-swatch";
        swatch.style.background = entry.color;
        swatch.title = entry.name + " — click to change color";
        swatch.setAttribute("aria-label", "Change color for " + entry.name);
        swatch.addEventListener("click", function () { self.cycleColor(index); });
        row.appendChild(swatch);
      });
    }

    applyEntriesFromText() {
      var lines = this.el.entriesInput.value
        .split(/\r?\n/)
        .map(function (line) { return line.trim(); })
        .filter(function (line) { return line.length > 0; });

      if (lines.length > 30) {
        lines = lines.slice(0, 30);
        this.el.entriesInput.value = lines.join("\n");
        this.toast("Maximum of 30 entries");
      }

      // Keep colors stable for entries whose names are unchanged.
      var old = this.entries;
      var colorByName = {};
      var used = {};
      old.forEach(function (e) {
        if (!(e.name in colorByName)) colorByName[e.name] = e.color;
      });

      this.entries = lines.map(function (name, i) {
        var color = colorByName[name] || (old[i] && old[i].color);
        if (!color || used[color.toLowerCase()]) {
          color = Wheel.PALETTE.filter(function (c) { return !used[c.toLowerCase()]; })[0]
            || Wheel.PALETTE[i % Wheel.PALETTE.length];
        }
        used[color.toLowerCase()] = true;
        return { name: name, color: color };
      });

      this.saveEntries();
      this.wheel.setEntries(this.entries);
      this.renderColorRow();
      this.updateEntryCounts();
    }

    clearEntries() {
      if (!global.confirm("Remove all entries from the wheel?")) return;
      this.entries = [];
      this.saveEntries();
      this.renderEntries();
      this.wheel.setEntries(this.entries);
      this.toast("All entries cleared");
    }

    cycleColor(index) {
      if (index < 0 || index >= this.entries.length) return;
      var colors = Wheel.PALETTE;
      var current = colors.indexOf(this.entries[index].color.toUpperCase());
      if (current === -1) current = 0;
      this.entries[index].color = colors[(current + 1) % colors.length];
      this.saveEntries();
      this.renderColorRow();
      this.wheel.setEntries(this.entries);
    }

    /* Randomize the order of the list; each entry keeps its own color. */
    shuffleEntries() {
      if (this.entries.length < 2) { this.toast("Add at least two entries to shuffle"); return; }
      this.entries = shuffle(this.entries);
      this.saveEntries();
      this.renderEntries();
      this.wheel.setEntries(this.entries);
      this.toast("Entries shuffled");
    }

    randomizeColors() {
      var shuffled = shuffle(Wheel.PALETTE);
      this.entries.forEach(function (entry, i) {
        entry.color = shuffled[i % shuffled.length];
      });
      this.saveEntries();
      this.renderEntries();
      this.wheel.setEntries(this.entries);
      this.toast("Colors randomized");
    }

    resetEntries() {
      this.entries = cloneDefaults();
      this.saveEntries();
      this.renderEntries();
      this.wheel.setEntries(this.entries);
      this.toast("Default entries restored");
    }

    resetWheel() {
      this.entries = cloneDefaults();
      this.saveEntries();
      this.renderEntries();
      this.wheel.setEntries(this.entries);
      this.resetPosition();
      this.toast("Wheel reset to defaults");
    }

    /* ================= HISTORY ================= */
    renderHistory() {
      var list = this.el.historyList;
      this.el.historyCount.textContent = this.history.length + (this.history.length === 1 ? " spin" : " spins");
      if (!this.history.length) {
        list.innerHTML = '<div class="empty-state">No spins yet — hold the button to make your first spin!</div>';
        return;
      }

      list.innerHTML = "";
      var self = this;
      this.history.slice(0, 50).forEach(function (record) {
        var row = document.createElement("div");
        row.className = "history-row";

        var dot = document.createElement("span");
        dot.className = "history-color";
        dot.style.background = record.color || "#7c6cff";

        var main = document.createElement("div");
        main.className = "history-main";
        var winner = document.createElement("div");
        winner.className = "history-winner";
        winner.textContent = record.winner;
        var meta = document.createElement("div");
        meta.className = "history-meta";
        var date = new Date(record.time);
        meta.textContent = isNaN(date.getTime()) ? "" : date.toLocaleString();
        main.appendChild(winner);
        main.appendChild(meta);

        var stats = document.createElement("div");
        stats.className = "history-stats";
        stats.innerHTML = "<b>" + record.strength + "%</b> power<br>" + record.rotations + " rotations";

        row.appendChild(dot);
        row.appendChild(main);
        row.appendChild(stats);
        list.appendChild(row);
      });
    }

    clearHistory() {
      this.history = [];
      Storage.set("history", this.history);
      this.renderHistory();
      this.toast("History cleared");
    }

    /* ================= SETTINGS / SOUND / FULLSCREEN ================= */
    syncSettingsUI() {
      this.el.soundToggle.checked = this.settings.sound;
      this.el.soundLabel.textContent = this.settings.sound ? "Sound On" : "Sound Off";
      this.el.chargeSpeedSlider.value = this.settings.chargeSeconds;
      this.el.chargeSpeedValue.textContent = Number(this.settings.chargeSeconds).toFixed(1) + "s";
    }

    applyControlsVisibility(visible) {
      this.settings.controlsVisible = !!visible;
      this.el.sideColumn.hidden = !visible;
      this.el.controlsToggleBtn.setAttribute("aria-expanded", visible ? "true" : "false");
      this.el.controlsToggleLabel.textContent = visible ? "Hide Controls" : "Show Controls";
      this.el.controlsToggleBtn.title = visible ? "Hide manual position and settings" : "Show manual position and settings";
      this.el.controlsToggleBtn.setAttribute("aria-label", this.el.controlsToggleBtn.title);
      this.saveSettings();
    }

    applyEntriesVisibility(visible) {
      this.settings.entriesVisible = !!visible;
      this.el.entriesPanel.hidden = !visible;
      this.el.wheelRow.classList.toggle("entries-hidden", !visible);
      this.el.entriesToggleBtn.setAttribute("aria-expanded", visible ? "true" : "false");
      this.el.entriesToggleLabel.textContent = visible ? "Hide Entries" : "Show Entries";
      var title = visible ? "Hide wheel entries" : "Show wheel entries";
      this.el.entriesToggleBtn.title = title;
      this.el.entriesToggleBtn.setAttribute("aria-label", title);
      this.saveSettings();
    }

    saveSettings() {
      Storage.set("settings", this.settings);
    }

    ensureAudio() {
      if (this.audioCtx) {
        if (this.audioCtx.state === "suspended") this.audioCtx.resume();
        return this.audioCtx;
      }
      var AudioCtx = global.AudioContext || global.webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        this.audioCtx = new AudioCtx();
      } catch (e) {
        return null;
      }
      return this.audioCtx;
    }

    playPress() {
      if (!this.settings.sound) return;
      var ctx = this.ensureAudio();
      if (!ctx) return;
      try {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(520, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(780, ctx.currentTime + 0.07);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.13);
      } catch (e) { /* audio is optional */ }
    }

    playMax() {
      if (!this.settings.sound) return;
      var ctx = this.ensureAudio();
      if (!ctx) return;
      try {
        [880, 1108, 1318].forEach(function (freq, i) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.value = freq;
          var t = ctx.currentTime + i * 0.06;
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.2);
        });
      } catch (e) { /* ignore */ }
    }

    startSpinSound() {
      if (!this.settings.sound) return;
      var ctx = this.ensureAudio();
      if (!ctx) return;
      try {
        var osc = ctx.createOscillator();
        var filter = ctx.createBiquadFilter();
        var gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.value = 70;
        filter.type = "lowpass";
        filter.frequency.value = 700;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.25);
        osc.connect(filter).connect(gain).connect(ctx.destination);
        osc.start();
        this.spinSound = { osc: osc, gain: gain, filter: filter, ctx: ctx };
      } catch (e) {
        this.spinSound = null;
      }
    }

    updateSpinSound(t) {
      if (!this.spinSound) return;
      try {
        var ctx = this.spinSound.ctx;
        var freq = 70 + 150 * Math.sin(Math.PI * t);
        this.spinSound.osc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.05);
        this.spinSound.filter.frequency.setTargetAtTime(500 + 900 * (1 - t), ctx.currentTime, 0.08);
      } catch (e) { /* ignore */ }
    }

    stopSpinSound() {
      if (!this.spinSound) return;
      try {
        var s = this.spinSound;
        s.gain.gain.cancelScheduledValues(s.ctx.currentTime);
        s.gain.gain.setValueAtTime(Math.max(s.gain.gain.value, 0.0001), s.ctx.currentTime);
        s.gain.gain.exponentialRampToValueAtTime(0.0001, s.ctx.currentTime + 0.35);
        s.osc.stop(s.ctx.currentTime + 0.4);
      } catch (e) { /* ignore */ }
      this.spinSound = null;
    }

    playWin() {
      if (!this.settings.sound) return;
      var ctx = this.ensureAudio();
      if (!ctx) return;
      try {
        var notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach(function (freq, i) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.value = freq;
          var t = ctx.currentTime + i * 0.12;
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(0.09, t + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.5);
        });
      } catch (e) { /* ignore */ }
    }

    toggleFullscreen() {
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          if (document.exitFullscreen) document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        } else {
          var root = document.documentElement;
          if (root.requestFullscreen) root.requestFullscreen();
          else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
        }
      } catch (e) {
        this.toast("Fullscreen is not available here");
      }
    }

    /* ================= CONFETTI ================= */
    launchConfetti() {
      var canvas = this.el.confettiCanvas;
      var ctx = canvas.getContext("2d");
      var w = canvas.width = global.innerWidth;
      var h = canvas.height = global.innerHeight;
      var colors = Wheel.PALETTE.concat(["#ffffff", "#a5b4fc", "#67e8f9"]);
      var particles = [];
      for (var i = 0; i < 130; i++) {
        particles.push({
          x: w * 0.5 + (Math.random() - 0.5) * w * 0.35,
          y: h * 0.42 + (Math.random() - 0.5) * 40,
          vx: (Math.random() - 0.5) * 13,
          vy: -Math.random() * 13 - 4,
          size: 5 + Math.random() * 8,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          color: colors[Math.floor(Math.random() * colors.length)]
        });
      }

      var start = performance.now();
      var self = this;
      function frame(now) {
        var elapsed = now - start;
        ctx.clearRect(0, 0, w, h);
        var alive = false;
        for (var i = 0; i < particles.length; i++) {
          var p = particles[i];
          p.vy += 0.28;
          p.vx *= 0.992;
          p.x += p.vx;
          p.y += p.vy;
          p.rot += p.vr;
          if (p.y < h + 30 && elapsed < 3600) {
            alive = true;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.globalAlpha = Math.max(0, 1 - elapsed / 4200);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
            ctx.restore();
          }
        }
        if (alive) self.confettiRaf = requestAnimationFrame(frame);
        else ctx.clearRect(0, 0, w, h);
      }
      if (this.confettiRaf) cancelAnimationFrame(this.confettiRaf);
      this.confettiRaf = requestAnimationFrame(frame);
    }

    /* ================= TOAST ================= */
    toast(message) {
      var el = this.el.toast;
      el.textContent = message;
      el.classList.add("show");
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
    }

    /* ================= UI WIRING ================= */
    _bindUI() {
      var self = this;
      var el = this.el;

      el.entriesInput.addEventListener("input", function () { self.applyEntriesFromText(); });

      el.shuffleEntriesBtn.addEventListener("click", function () { self.shuffleEntries(); });
      el.randomizeColorsBtn.addEventListener("click", function () { self.randomizeColors(); });
      el.resetEntriesBtn.addEventListener("click", function () { self.resetEntries(); });
      el.clearEntriesBtn.addEventListener("click", function () { self.clearEntries(); });
      el.clearHistoryBtn.addEventListener("click", function () { self.clearHistory(); });
      el.resetWheelBtn.addEventListener("click", function () { self.resetWheel(); });
      el.entriesToggleBtn.addEventListener("click", function () {
        self.applyEntriesVisibility(!self.settings.entriesVisible);
      });
      el.controlsToggleBtn.addEventListener("click", function () {
        self.applyControlsVisibility(!self.settings.controlsVisible);
      });
      el.fullscreenBtn.addEventListener("click", function () { self.toggleFullscreen(); });
      el.fullscreenBtn2.addEventListener("click", function () { self.toggleFullscreen(); });

      el.soundToggle.addEventListener("change", function () {
        self.settings.sound = el.soundToggle.checked;
        self.el.soundLabel.textContent = self.settings.sound ? "Sound On" : "Sound Off";
        self.saveSettings();
        if (self.settings.sound) self.playPress();
      });

      el.chargeSpeedSlider.addEventListener("input", function () {
        self.settings.chargeSeconds = parseFloat(el.chargeSpeedSlider.value);
        el.chargeSpeedValue.textContent = self.settings.chargeSeconds.toFixed(1) + "s";
        self.saveSettings();
      });

      el.removeWinnerBtn.addEventListener("click", function () { self.removeWinner(); });
      el.closeModalBtn.addEventListener("click", function () { self.closeModal(); });
      el.modalCloseX.addEventListener("click", function () { self.closeModal(); });
      el.modalBackdrop.addEventListener("click", function () { self.closeModal(); });
      el.spinAgainBtn.addEventListener("click", function () {
        self.closeModal();
        setTimeout(function () {
          el.holdBtn.focus();
          el.holdBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 80);
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && el.winnerModal.classList.contains("open")) self.closeModal();
      });
    }
  }

  function boot() {
    global.app = new App();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
