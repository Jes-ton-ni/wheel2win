/* ============================================================
   wheel.js — Canvas wheel rendering + single source of truth
   for the wheel's rotation angle (in DEGREES, clockwise-positive).
   ============================================================ */
(function (global) {
  "use strict";

  var FONT = '"Segoe UI", Inter, system-ui, -apple-system, Roboto, sans-serif';

  var PALETTE = [
    "#FF6B6B", "#4ECDC4", "#FFE66D", "#A78BFA", "#38BDF8", "#F472B6",
    "#34D399", "#FB923C", "#818CF8", "#F87171", "#2DD4BF", "#E879F9"
  ];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  class Wheel {
    constructor(canvas, stage, entries) {
      this.canvas = canvas;
      this.stage = stage;
      this.ctx = canvas.getContext("2d");
      this.entries = entries || [];
      this.rotation = 0;          // <- THE single source of truth (degrees)
      this.size = 0;
      this.dpr = 1;

      var self = this;
      if (global.ResizeObserver) {
        this.observer = new ResizeObserver(function () { self.resize(); });
        this.observer.observe(stage);
      } else {
        global.addEventListener("resize", function () { self.resize(); });
      }
      this.resize();
    }

    static normalize(deg) {
      return ((deg % 360) + 360) % 360;
    }

    setEntries(entries) {
      this.entries = entries;
      this.draw();
    }

    setRotation(deg) {
      this.rotation = deg;
      this.draw();
    }

    resize() {
      var rect = this.stage.getBoundingClientRect();
      var size = Math.max(1, Math.round(Math.min(rect.width, rect.height)));
      if (size === this.size && this.dpr === (global.devicePixelRatio || 1)) return;

      this.size = size;
      this.dpr = global.devicePixelRatio || 1;
      // The canvas is sized to 100% of the stage by CSS; the backing store
      // matches that CSS size at device-pixel resolution.
      this.canvas.width = Math.round(size * this.dpr);
      this.canvas.height = Math.round(size * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.draw();
    }

    /* Mathematically determine the section sitting under the fixed top pointer.
       Section i occupies local angles [i*sector, (i+1)*sector).
       A local angle theta is drawn at screen angle theta + rotation - 90 - sector/2.
       The pointer is at screen angle -90deg, so local angle = sector/2 - rotation. */
    winnerIndex() {
      var n = this.entries.length;
      if (n === 0) return -1;
      var sector = 360 / n;
      var local = Wheel.normalize(sector / 2 - this.rotation);
      return clamp(Math.floor(local / sector), 0, n - 1);
    }

    draw() {
      var ctx = this.ctx;
      var size = this.size;
      if (!size) return;

      var cx = size / 2;
      var cy = size / 2;
      var r = size / 2 - 10;
      var n = this.entries.length;

      ctx.clearRect(0, 0, size, size);

      // Faint outer glow ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(124,108,255,.12)";
      ctx.shadowColor = "rgba(124,108,255,.55)";
      ctx.shadowBlur = 26;
      ctx.fill();
      ctx.restore();

      if (n < 1) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = "#1b2444";
        ctx.fill();
        ctx.strokeStyle = "rgba(148,163,255,.35)";
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(238,242,255,.75)";
        ctx.font = "600 " + Math.max(14, r * 0.12) + "px " + FONT;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Add entries to spin", cx, cy);
        this._drawHub(cx, cy, r);
        return;
      }

      var sector = 360 / n;
      var sectorRad = sector * Math.PI / 180;

      // Sections
      for (var i = 0; i < n; i++) {
        var start = (this.rotation + i * sector - 90 - sector / 2) * Math.PI / 180;
        var end = start + sectorRad;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, start, end);
        ctx.closePath();
        ctx.fillStyle = this.entries[i].color || PALETTE[i % PALETTE.length];
        ctx.fill();
      }

      // Depth gradient over the whole disc
      var depth = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.1, cx, cy, r);
      depth.addColorStop(0, "rgba(255,255,255,.16)");
      depth.addColorStop(0.55, "rgba(255,255,255,0)");
      depth.addColorStop(1, "rgba(0,0,0,.26)");
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = depth;
      ctx.fill();

      // Separator lines
      ctx.strokeStyle = "rgba(255,255,255,.72)";
      ctx.lineWidth = Math.max(1, r * 0.008);
      for (var j = 0; j < n; j++) {
        var boundary = (this.rotation + j * sector - 90 - sector / 2) * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(boundary) * (r * 0.17), cy + Math.sin(boundary) * (r * 0.17));
        ctx.lineTo(cx + Math.cos(boundary) * r, cy + Math.sin(boundary) * r);
        ctx.stroke();
      }

      // Labels
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(0,0,0,.55)";
      ctx.shadowBlur = Math.max(3, r * 0.022);
      var arcLength = 2 * Math.PI * r / n;
      var maxSize = clamp(arcLength * 0.3, 11, Math.min(34, r * 0.16));
      for (var k = 0; k < n; k++) {
        var midDeg = this.rotation + k * sector - 90;
        var midRad = midDeg * Math.PI / 180;
        var norm = Wheel.normalize(midDeg) * Math.PI / 180;

        var label = String(this.entries[k].name || "");
        var fitted = this._fitLabel(ctx, label, r * 0.64, maxSize, 9);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(midRad);
        if (norm > Math.PI / 2 && norm < Math.PI * 1.5) {
          ctx.rotate(Math.PI);
          ctx.textAlign = "left";
          ctx.fillText(fitted.text, -(r - Math.max(14, r * 0.11)), 0);
        } else {
          ctx.textAlign = "right";
          ctx.fillText(fitted.text, r - Math.max(14, r * 0.11), 0);
        }
        ctx.restore();
      }
      ctx.shadowBlur = 0;

      // Rim
      var rim = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      rim.addColorStop(0, "#c7d2fe");
      rim.addColorStop(0.5, "#818cf8");
      rim.addColorStop(1, "#67e8f9");
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(5, r * 0.035);
      ctx.strokeStyle = rim;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r - Math.max(5, r * 0.035) / 2 - 1, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.stroke();

      this._drawHub(cx, cy, r);
    }

    _fitLabel(ctx, text, maxWidth, maxSize, minSize) {
      var size = maxSize;
      ctx.font = "700 " + size + "px " + FONT;
      ctx.textBaseline = "middle";
      while (ctx.measureText(text).width > maxWidth && size > minSize) {
        size -= 1;
        ctx.font = "700 " + size + "px " + FONT;
      }
      var out = text;
      while (out.length > 1 && ctx.measureText(out + "…").width > maxWidth) {
        out = out.slice(0, -1);
      }
      if (out !== text) out = out.trimEnd() + "…";
      return { text: out, size: size };
    }

    _drawHub(cx, cy, r) {
      var ctx = this.ctx;
      var hubR = clamp(r * 0.16, 20, 48);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, hubR + 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(6,10,24,.65)";
      ctx.shadowColor = "rgba(0,0,0,.6)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      ctx.fill();
      ctx.restore();

      var g = ctx.createRadialGradient(cx - hubR * 0.35, cy - hubR * 0.4, hubR * 0.1, cx, cy, hubR);
      g.addColorStop(0, "#4b5aa0");
      g.addColorStop(0.6, "#1c2547");
      g.addColorStop(1, "#0a0f24");
      ctx.beginPath();
      ctx.arc(cx, cy, hubR, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = Math.max(2, hubR * 0.09);
      ctx.strokeStyle = "#a5b4fc";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, hubR * 0.42, 0, Math.PI * 2);
      var inner = ctx.createRadialGradient(cx - hubR * 0.15, cy - hubR * 0.2, 1, cx, cy, hubR * 0.42);
      inner.addColorStop(0, "#e0e7ff");
      inner.addColorStop(1, "#6366f1");
      ctx.fillStyle = inner;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx - hubR * 0.18, cy - hubR * 0.22, hubR * 0.1, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,.75)";
      ctx.fill();
    }
  }

  Wheel.PALETTE = PALETTE;
  global.Wheel = Wheel;
})(window);
