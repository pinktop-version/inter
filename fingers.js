// Chapter 8 : 여덟 손가락 메시지 — 엄지와 맞대면 소리가 난다
// 좌표계는 비디오 원본 픽셀 기준이며, 호출 시점의 ctx는 셀피 미러링 상태다.

const THUMB_TIP = 4;
const FINGERS = [
  { tip: 8, name: "검지" },
  { tip: 12, name: "중지" },
  { tip: 16, name: "약지" },
  { tip: 20, name: "새끼" },
];

// 손가락 8개에 배정할 5음계 (C 메이저 펜타토닉)
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
const HUES = [190, 205, 220, 240, 285, 320, 350, 20];

/* ── 소리 ────────────────────────────────────────────── */

let audio = null;

function tone(freq) {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const t = audio.currentTime;

    const osc = audio.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;

    // 배음을 살짝 얹어 통통 튀는 소리를 만든다
    const bell = audio.createOscillator();
    bell.type = "sine";
    bell.frequency.value = freq * 2;

    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);

    const bellGain = audio.createGain();
    bellGain.gain.setValueAtTime(0.0001, t);
    bellGain.gain.exponentialRampToValueAtTime(0.09, t + 0.008);
    bellGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);

    osc.connect(gain).connect(audio.destination);
    bell.connect(bellGain).connect(audio.destination);
    osc.start(t); osc.stop(t + 0.75);
    bell.start(t); bell.stop(t + 0.3);
  } catch { /* 소리가 안 나도 표시는 계속된다 */ }
}

/* ── 메시지 → 손가락 여덟 개 ─────────────────────────── */

export function messageChars(message) {
  const chars = [...(message ?? "").replace(/\s+/g, "")];
  if (!chars.length) return Array(8).fill("·");
  return Array.from({ length: 8 }, (_, i) => chars[i % chars.length]);
}

/* ── 그리기 ──────────────────────────────────────────── */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class FingerMessage {
  constructor() {
    this.reset();
  }

  reset() {
    this.held = new Set();   // 지금 맞대고 있는 손가락 (연속 발음 방지)
    this.ripples = [];
    this.hits = 0;
  }

  /**
   * @param result 핸드 트래킹 결과
   * @param message 손가락에 표시할 메시지
   */
  draw(ctx, video, W, H, result, message, t) {
    ctx.drawImage(video, 0, 0, W, H);

    const chars = messageChars(message);
    const hands = (result?.landmarks ?? []).slice(0, 2);
    const size = Math.min(W, H);

    // 손가락 여덟 개를 화면 왼쪽부터 늘어놓아야 메시지가 읽히는 순서대로 붙는다.
    // (미러 화면이므로 화면 x는 W - 원본 x)
    const tips = [];
    hands.forEach((lm, handIdx) => {
      const thumb = lm[THUMB_TIP];
      const scale =
        Math.hypot((lm[9].x - lm[0].x) * W, (lm[9].y - lm[0].y) * H) || size * 0.2;
      FINGERS.forEach((finger, j) => {
        const p = lm[finger.tip];
        const x = p.x * W, y = p.y * H;
        tips.push({
          key: `${handIdx}:${j}`,
          x, y,
          screenX: W - x,
          touching: Math.hypot((thumb.x - p.x) * W, (thumb.y - p.y) * H) < scale * 0.42,
        });
      });
    });
    tips.sort((a, b) => a.screenX - b.screenX);

    const seen = new Set();
    tips.slice(0, 8).forEach((tip, slot) => {
      if (tip.touching) seen.add(tip.key);

      // 맞댄 순간에만 한 번 울린다
      if (tip.touching && !this.held.has(tip.key)) {
        tone(SCALE[slot]);
        this.hits++;
        this.ripples.push({ x: tip.x, y: tip.y, born: t, hue: HUES[slot] });
      }

      // 말풍선 높이를 번갈아 띄워 이웃끼리 겹치지 않게 한다
      this.drawLabel(ctx, W, H, tip.x, tip.y, chars[slot], HUES[slot], tip.touching, size, slot % 2);
    });

    this.held = seen;
    this.drawRipples(ctx, W, H, t, size);
  }

  drawLabel(ctx, W, H, x, y, char, hue, active, size, tier = 0) {
    // 미러 화면에서 글자가 뒤집히지 않도록 화면 좌표로 변환해 그린다
    const sx = W - x, sy = y;
    const fs = Math.max(18, Math.round(size * 0.055));
    const pad = fs * 0.55;
    const lift = fs * (1.9 + tier * 1.15);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `800 ${fs}px "Pretendard", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const w = Math.max(ctx.measureText(char).width + pad * 2, fs * 1.8);
    const h = fs + pad * 1.4;
    const bx = sx - w / 2, by = sy - lift - h / 2;

    // 손가락 끝과 말풍선을 잇는 선
    ctx.strokeStyle = `hsla(${hue}, 90%, 70%, ${active ? 0.95 : 0.5})`;
    ctx.lineWidth = active ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, by + h);
    ctx.stroke();

    // 손가락 끝 점
    ctx.beginPath();
    ctx.arc(sx, sy, active ? fs * 0.42 : fs * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, 90%, 65%, ${active ? 0.95 : 0.55})`;
    ctx.fill();

    // 말풍선
    if (active) {
      ctx.shadowColor = `hsla(${hue}, 95%, 65%, 0.9)`;
      ctx.shadowBlur = fs * 0.9;
    }
    ctx.fillStyle = active ? `hsl(${hue}, 92%, 62%)` : "rgba(15,18,24,0.78)";
    roundRect(ctx, bx, by, w, h, h * 0.34);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.lineWidth = 2;
    ctx.strokeStyle = `hsla(${hue}, 90%, 72%, ${active ? 1 : 0.6})`;
    roundRect(ctx, bx, by, w, h, h * 0.34);
    ctx.stroke();

    ctx.fillStyle = active ? "#0b1013" : "#eef2f7";
    ctx.fillText(char, sx, by + h / 2 + 1);
    ctx.restore();
  }

  drawRipples(ctx, W, H, t, size) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      const age = (t - r.born) / 700;
      if (age >= 1) { this.ripples.splice(i, 1); continue; }
      ctx.globalAlpha = (1 - age) * 0.8;
      ctx.strokeStyle = `hsl(${r.hue}, 95%, 68%)`;
      ctx.lineWidth = size * 0.012 * (1 - age);
      ctx.beginPath();
      ctx.arc(W - r.x, r.y, size * (0.03 + age * 0.16), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
