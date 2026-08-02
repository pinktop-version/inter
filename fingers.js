// Chapter 8 : 여덟 손가락 메시지 — 엄지와 맞대면 소리가 난다
// 좌표계는 비디오 원본 픽셀 기준이며, 호출 시점의 ctx는 셀피 미러링 상태다.

// mcp = 손등 관절. 손끝은 입술로 가져가면 위치가 변하지만 관절은 제자리에
// 있으므로, 글자 순서는 관절 기준으로 정해야 흔들리지 않는다.
const FINGERS = [
  { tip: 8, mcp: 5, name: "검지" },
  { tip: 12, mcp: 9, name: "중지" },
  { tip: 16, mcp: 13, name: "약지" },
  { tip: 20, mcp: 17, name: "새끼" },
];

// 손가락 8개에 배정할 5음계 (C 메이저 펜타토닉)
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
const HUES = [190, 205, 220, 240, 285, 320, 350, 20];

/* ── 소리 ────────────────────────────────────────────── */

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
    u.volume = 1;
    speechSynthesis.speak(u);
  } catch {
    tone(fallbackFreq);
  }
}

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

/** 얼굴 랜드마크에서 입술 중심과 크기를 구한다 */
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
    reach: Math.max((x1 - x0) / 2, (y1 - y0) / 2) * 1.35,  // 닿았다고 볼 범위
  };
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
  draw(ctx, video, W, H, handResult, faceResult, FaceLandmarker, message, t) {
    ctx.drawImage(video, 0, 0, W, H);

    const chars = messageChars(message);
    const hands = (handResult?.landmarks ?? []).slice(0, 2);
    const size = Math.min(W, H);
    const lips = lipsOf(faceResult, FaceLandmarker, W, H);

    if (lips) this.drawLips(ctx, W, H, lips, t);

    // 메시지가 화면 왼쪽부터 읽히도록, 손은 손목 위치 순으로 손가락은 손등 관절
    // 위치 순으로 늘어놓는다. (미러 화면이므로 화면 x는 W - 원본 x)
    const tips = [];
    hands
      .map((lm, handIdx) => ({ lm, handIdx, wristX: W - lm[0].x * W }))
      .sort((a, b) => a.wristX - b.wristX)
      .forEach(({ lm, handIdx }, handOrder) => {
        FINGERS
          .map((finger, j) => ({ finger, j, knuckleX: W - lm[finger.mcp].x * W }))
          .sort((a, b) => a.knuckleX - b.knuckleX)
          .forEach(({ finger, j }, fingerOrder) => {
            const p = lm[finger.tip];
            const x = p.x * W, y = p.y * H;
            tips.push({
              key: `${handIdx}:${j}`,
              slot: handOrder * 4 + fingerOrder,
              x, y,
              touching: lips ? Math.hypot(x - lips.x, y - lips.y) < lips.reach : false,
            });
          });
      });

    const seen = new Set();
    tips.filter((tip) => tip.slot < 8).forEach((tip) => {
      const slot = tip.slot;
      if (tip.touching) seen.add(tip.key);

      // 입술에 닿는 순간에만 한 번 읽는다
      if (tip.touching && !this.held.has(tip.key)) {
        speak(chars[slot], SCALE[slot]);
        this.hits++;
        this.ripples.push({ x: tip.x, y: tip.y, born: t, hue: HUES[slot] });
      }

      // 말풍선 높이를 번갈아 띄워 이웃끼리 겹치지 않게 한다
      this.drawLabel(ctx, W, H, tip.x, tip.y, chars[slot], HUES[slot], tip.touching, size, slot % 2);
    });

    this.held = seen;
    this.drawRipples(ctx, W, H, t, size);
  }

  /** 입술을 목표 지점으로 표시한다 */
  drawLips(ctx, W, H, lips, t) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sx = W - lips.x, sy = lips.y;
    const pulse = 1 + Math.sin(t / 260) * 0.06;

    ctx.strokeStyle = "rgba(244,114,182,0.85)";
    ctx.lineWidth = Math.max(2, lips.reach * 0.09);
    ctx.setLineDash([lips.reach * 0.4, lips.reach * 0.3]);
    ctx.beginPath();
    ctx.arc(sx, sy, lips.reach * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(244,114,182,0.18)";
    ctx.beginPath();
    ctx.ellipse(sx, sy, lips.rx, lips.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
