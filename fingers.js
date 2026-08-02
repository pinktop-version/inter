// 손가락 오버레이 두 종류
//  - FingerMessage : 여덟 손가락에 글자를 띄우고, 입술에 대면 그 글자를 읽는다
//  - FingerMelody  : 여덟 손가락에 음을 배정하고, 엄지에 맞대면 실로폰이 울린다
// 좌표계는 비디오 원본 픽셀 기준이며, 호출 시점의 ctx는 셀피 미러링 상태다.

const THUMB_TIP = 4;

// mcp = 손등 관절. 손끝은 입술이나 엄지로 가져가면 위치가 변하지만 관절은
// 제자리에 있으므로, 순서는 관절 기준으로 정해야 흔들리지 않는다.
const FINGERS = [
  { tip: 8, mcp: 5, name: "검지" },
  { tip: 12, mcp: 9, name: "중지" },
  { tip: 16, mcp: 13, name: "약지" },
  { tip: 20, mcp: 17, name: "새끼" },
];

// 화면 왼쪽(왼손 새끼)부터 도-레-미-파-솔-라-시-도
export const SCALE = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25];
export const NOTE_NAMES = ["도", "레", "미", "파", "솔", "라", "시", "도"];
const HUES = [190, 205, 220, 240, 285, 320, 350, 20];

/* ── 소리 ────────────────────────────────────────────── */

let audio = null;

function ac() {
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === "suspended") audio.resume();
  return audio;
}

/** 실로폰 — 짧고 밝은 타격음. 위 배음일수록 빨리 사라져 나무 막대 느낌이 난다. */
export function xylophone(freq) {
  try {
    const a = ac();
    const t = a.currentTime;
    for (const [mult, amp, dur] of [[1, 0.5, 1.0], [3.01, 0.14, 0.32], [6.35, 0.06, 0.15]]) {
      const osc = a.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * mult;
      const gain = a.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(amp, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(a.destination);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    }
  } catch { /* 소리가 안 나도 표시는 계속된다 */ }
}

function tone(freq) {
  try {
    const a = ac();
    const t = a.currentTime;
    const osc = a.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const gain = a.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + 0.75);
  } catch { /* 무시 */ }
}

// 글자를 음성으로 읽는다. 음성 합성을 못 쓰면 음으로 대신한다.
const canSpeak = typeof speechSynthesis !== "undefined" &&
  typeof SpeechSynthesisUtterance !== "undefined";

function speak(char, fallbackFreq) {
  if (!canSpeak) return tone(fallbackFreq);
  try {
    // 연달아 짚어도 밀리지 않도록 이전 발음을 끊는다
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(char);
    u.lang = /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(char) ? "ko-KR" : "en-US";
    u.rate = 0.85;
    u.pitch = 1.15;
    speechSynthesis.speak(u);
  } catch {
    tone(fallbackFreq);
  }
}

/* ── 메시지 → 손가락 여덟 개 ─────────────────────────── */

export function messageChars(message) {
  const chars = [...(message ?? "").replace(/\s+/g, "")];
  if (!chars.length) return Array(8).fill("·");
  return Array.from({ length: 8 }, (_, i) => chars[i % chars.length]);
}

/* ── 입술 ────────────────────────────────────────────── */

let lipIndices = null;

function lipsOf(faceResult, FaceLandmarker, W, H) {
  const lm = faceResult?.faceLandmarks?.[0];
  if (!lm) return null;

  if (!lipIndices) {
    const set = new Set();
    for (const c of FaceLandmarker.FACE_LANDMARKS_LIPS) { set.add(c.start); set.add(c.end); }
    lipIndices = [...set];
  }

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sx = 0, sy = 0;
  for (const i of lipIndices) {
    const p = lm[i];
    if (!p) continue;
    const x = p.x * W, y = p.y * H;
    sx += x; sy += y;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  if (!isFinite(x0)) return null;

  return {
    x: sx / lipIndices.length,
    y: sy / lipIndices.length,
    rx: (x1 - x0) / 2,
    ry: (y1 - y0) / 2,
    // 입 주변을 스치기만 해도 걸리지 않도록 좁게 잡는다
    reach: Math.max((x1 - x0) * 0.26, (y1 - y0) * 0.6),
  };
}

/* ── 손가락 순서 ─────────────────────────────────────── */

/**
 * 여덟 손가락을 화면 왼쪽부터 늘어놓고 자리(slot)를 매긴다.
 * 손은 손목, 손가락은 손등 관절 위치를 기준으로 삼는다.
 */
export function orderedFingers(hands, W, H, size) {
  const out = [];
  hands
    .map((lm, handIdx) => ({ lm, handIdx, wristX: W - lm[0].x * W }))
    .sort((a, b) => a.wristX - b.wristX)
    .forEach(({ lm, handIdx }, handOrder) => {
      const thumb = lm[THUMB_TIP];
      const palm =
        Math.hypot((lm[9].x - lm[0].x) * W, (lm[9].y - lm[0].y) * H) || size * 0.2;

      FINGERS
        .map((finger, j) => ({ finger, j, knuckleX: W - lm[finger.mcp].x * W }))
        .sort((a, b) => a.knuckleX - b.knuckleX)
        .forEach(({ finger, j }, fingerOrder) => {
          const p = lm[finger.tip];
          const x = p.x * W, y = p.y * H;
          out.push({
            key: `${handIdx}:${j}`,
            slot: handOrder * 4 + fingerOrder,
            x, y,
            thumbGap: Math.hypot((thumb.x - p.x) * W, (thumb.y - p.y) * H),
            palm,
          });
        });
    });
  return out.filter((t) => t.slot < 8);
}

/* ── 공통 그리기 ─────────────────────────────────────── */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

class FingerOverlay {
  constructor() {
    this.reset();
  }

  reset() {
    this.held = new Set();
    this.ripples = [];
    this.hits = 0;
  }

  /** 닿는 순간에만 한 번 반응한다 */
  resolve(tips, isTouching, onHit, t) {
    const seen = new Set();
    for (const tip of tips) {
      if (!isTouching(tip)) continue;
      seen.add(tip.key);
      if (this.held.has(tip.key)) continue;
      onHit(tip);
      this.hits++;
      this.ripples.push({ x: tip.x, y: tip.y, born: t, hue: HUES[tip.slot] });
    }
    this.held = seen;
  }

  drawLabel(ctx, W, H, x, y, text, hue, active, size, tier = 0) {
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

    const w = Math.max(ctx.measureText(text).width + pad * 2, fs * 1.8);
    const h = fs + pad * 1.4;
    const bx = sx - w / 2, by = sy - lift - h / 2;

    ctx.strokeStyle = `hsla(${hue}, 90%, 70%, ${active ? 0.95 : 0.5})`;
    ctx.lineWidth = active ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx, by + h);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(sx, sy, active ? fs * 0.42 : fs * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, 90%, 65%, ${active ? 0.95 : 0.55})`;
    ctx.fill();

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
    ctx.fillText(text, sx, by + h / 2 + 1);
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

/* ── 손가락 메시지 : 입술에 대면 글자를 읽는다 ───────── */

export class FingerMessage extends FingerOverlay {
  draw(ctx, video, W, H, handResult, faceResult, FaceLandmarker, message, t) {
    ctx.drawImage(video, 0, 0, W, H);

    const size = Math.min(W, H);
    const chars = messageChars(message);
    const tips = orderedFingers((handResult?.landmarks ?? []).slice(0, 2), W, H, size);
    const lips = lipsOf(faceResult, FaceLandmarker, W, H);

    if (lips) this.drawLips(ctx, W, H, lips, t);

    const touching = (tip) =>
      !!lips && Math.hypot(tip.x - lips.x, tip.y - lips.y) < lips.reach;

    this.resolve(tips, touching, (tip) => speak(chars[tip.slot], SCALE[tip.slot]), t);

    for (const tip of tips) {
      this.drawLabel(ctx, W, H, tip.x, tip.y, chars[tip.slot], HUES[tip.slot],
        touching(tip), size, tip.slot % 2);
    }
    this.drawRipples(ctx, W, H, t, size);
  }

  drawLips(ctx, W, H, lips, t) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sx = W - lips.x, sy = lips.y;
    const pulse = 1 + Math.sin(t / 260) * 0.06;

    ctx.strokeStyle = "rgba(244,114,182,0.85)";
    ctx.lineWidth = Math.max(2, lips.reach * 0.16);
    ctx.setLineDash([lips.reach * 0.5, lips.reach * 0.4]);
    ctx.beginPath();
    ctx.arc(sx, sy, lips.reach * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(244,114,182,0.16)";
    ctx.beginPath();
    ctx.ellipse(sx, sy, lips.rx, lips.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ── 손가락 멜로디 : 엄지에 맞대면 실로폰이 울린다 ───── */

export class FingerMelody extends FingerOverlay {
  draw(ctx, video, W, H, handResult, t) {
    ctx.drawImage(video, 0, 0, W, H);

    const size = Math.min(W, H);
    const tips = orderedFingers((handResult?.landmarks ?? []).slice(0, 2), W, H, size);

    const touching = (tip) => tip.thumbGap < tip.palm * 0.4;

    this.resolve(tips, touching, (tip) => xylophone(SCALE[tip.slot]), t);

    for (const tip of tips) {
      this.drawLabel(ctx, W, H, tip.x, tip.y, NOTE_NAMES[tip.slot], HUES[tip.slot],
        touching(tip), size, tip.slot % 2);
    }
    this.drawRipples(ctx, W, H, t, size);
  }
}
