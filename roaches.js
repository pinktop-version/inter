// Chapter 7 : 손가락으로 바퀴벌레 잡기
// 좌표계는 비디오 원본 픽셀 기준이며, 호출 시점의 ctx는 셀피 미러링 상태다.

const TIPS = [8]; // 검지 끝 랜드마크

const rnd = (a, b) => a + Math.random() * (b - a);

/* ── 바퀴벌레 그리기 (로컬 +x가 진행 방향) ───────────── */

function drawRoach(ctx, r, t) {
  const s = r.size;
  const gait = t * 0.018 * (0.6 + r.speed / 60);

  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.rotate(r.angle);
  ctx.scale(r.squish, 1);

  // 다리 6개 — 좌우가 반대 위상으로 교차하며 움직인다
  ctx.strokeStyle = "#22150d";
  ctx.lineWidth = Math.max(1, s * 0.055);
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const swing = Math.sin(gait + i * 1.9 + (side > 0 ? Math.PI : 0)) * 0.5;
      const bx = (0.22 - i * 0.28) * s;
      const by = side * s * 0.26;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(
        bx + s * 0.18 * swing, by + side * s * 0.34,
        bx + s * (0.3 + 0.16 * swing), by + side * s * 0.62
      );
      ctx.stroke();
    }
  }

  // 더듬이 — 다리보다 느리게 흔들린다
  ctx.lineWidth = Math.max(1, s * 0.038);
  for (const side of [-1, 1]) {
    const wag = Math.sin(gait * 0.55 + (side > 0 ? 1.4 : 0)) * 0.32;
    ctx.beginPath();
    ctx.moveTo(s * 0.4, side * s * 0.1);
    ctx.quadraticCurveTo(
      s * 0.75, side * s * (0.32 + wag),
      s * (1.05 + wag * 0.2), side * s * (0.42 + wag * 1.1)
    );
    ctx.stroke();
  }

  // 배 — 짙은 갈색 타원
  const body = ctx.createLinearGradient(-s * 0.5, 0, s * 0.5, 0);
  body.addColorStop(0, "#2e1c0f");
  body.addColorStop(0.55, "#5a3a1c");
  body.addColorStop(1, "#3d2612");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.5, s * 0.33, 0, 0, Math.PI * 2);
  ctx.fill();

  // 날개 이음선
  ctx.strokeStyle = "rgba(20,12,6,0.75)";
  ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath();
  ctx.moveTo(-s * 0.42, 0);
  ctx.lineTo(s * 0.2, 0);
  ctx.stroke();

  // 앞가슴등판 + 머리
  ctx.fillStyle = "#6b4522";
  ctx.beginPath();
  ctx.ellipse(s * 0.24, 0, s * 0.22, s * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#241609";
  ctx.beginPath();
  ctx.ellipse(s * 0.42, 0, s * 0.12, s * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();

  // 등껍질 하이라이트
  ctx.fillStyle = "rgba(255,225,180,0.16)";
  ctx.beginPath();
  ctx.ellipse(-s * 0.05, -s * 0.12, s * 0.28, s * 0.1, -0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawSplat(ctx, sp, age) {
  const s = sp.size;
  const pop = Math.min(1, age / 0.03); // 터지는 순간 확 퍼진다

  ctx.save();
  ctx.translate(sp.x, sp.y);
  ctx.globalAlpha = age > 0.75 ? Math.max(0, (1 - age) / 0.25) : 1;

  // 터지는 순간의 섬광 — 잔해에 가려지도록 가장 뒤에 깐다
  if (age < 0.06) {
    const k = age / 0.06;
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.85;
    ctx.fillStyle = "#fffbe8";
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.95 * (1 - k * 0.4), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 튀어나간 즙과 껍질 파편 — 날아간 방향으로 길쭉하게 늘어난다
  for (const p of sp.parts) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.y, p.x));
    if (p.kind === "shell") {
      ctx.rotate(p.rot);
      ctx.fillStyle = "#241608";
      ctx.fillRect(-p.r * s, -p.r * s * 0.5, p.r * s * 2, p.r * s);
    } else {
      ctx.fillStyle = p.kind === "guts" ? "#e0c274" : "#5b3a1b";
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r * s * p.elong, p.r * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 부러져 뻗은 다리
  ctx.strokeStyle = "#241608";
  ctx.lineWidth = Math.max(1, s * 0.055);
  ctx.lineCap = "round";
  for (const lg of sp.legs) {
    const dx = Math.cos(lg.a), dy = Math.sin(lg.a);
    const L = lg.len * s * pop;
    ctx.beginPath();
    ctx.moveTo(dx * s * 0.2, dy * s * 0.2);
    ctx.quadraticCurveTo(
      dx * L * 0.6 - dy * lg.bend * s, dy * L * 0.6 + dx * lg.bend * s,
      dx * L, dy * L
    );
    ctx.stroke();
  }

  // 짓뭉개진 잔해 — 울퉁불퉁한 웅덩이
  ctx.fillStyle = "#33200f";
  ctx.beginPath();
  sp.lobes.forEach((k, i) => {
    const a = (i / sp.lobes.length) * Math.PI * 2;
    const r = s * 0.5 * k * pop;
    i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
            : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  });
  ctx.closePath();
  ctx.fill();

  // 터져 나온 내장
  ctx.fillStyle = "rgba(228,199,120,0.95)";
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.26 * pop, s * 0.19 * pop, sp.angle, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(70,44,20,0.9)";
  ctx.beginPath();
  ctx.ellipse(s * 0.06, -s * 0.04, s * 0.1 * pop, s * 0.07 * pop, sp.angle, 0, Math.PI * 2);
  ctx.fill();

  // 바깥으로 퍼지는 충격파
  if (age < 0.13) {
    const k = age / 0.13;
    ctx.globalAlpha = (1 - k) * 0.75;
    ctx.strokeStyle = "#fde68a";
    ctx.lineWidth = s * 0.34 * (1 - k);
    ctx.beginPath();
    ctx.arc(0, 0, s * (0.5 + k * 3.6), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/* ── 소리 ────────────────────────────────────────────── */

let audio = null;

function crunch() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    const dur = 0.09;
    const buf = audio.createBuffer(1, audio.sampleRate * dur, audio.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length) ** 2.5;
    }
    const src = audio.createBufferSource();
    src.buffer = buf;
    const filter = audio.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1400;
    const gain = audio.createGain();
    gain.gain.value = 0.35;
    src.connect(filter).connect(gain).connect(audio.destination);
    src.start();
  } catch { /* 소리는 실패해도 게임에 영향 없음 */ }
}

/* ── 게임 ────────────────────────────────────────────── */

export class RoachGame {
  constructor() {
    this.reset();
  }

  reset() {
    this.roaches = [];
    this.splats = [];
    this.score = 0;
    this.spawnAcc = 0;
    this.flash = 0;
  }

  spawn(W, H) {
    const size = rnd(0.05, 0.075) * Math.min(W, H);
    const edge = (Math.random() * 4) | 0;
    const m = size;
    const pos = [
      { x: rnd(0, W), y: -m },
      { x: W + m, y: rnd(0, H) },
      { x: rnd(0, W), y: H + m },
      { x: -m, y: rnd(0, H) },
    ][edge];

    this.roaches.push({
      ...pos,
      size,
      angle: Math.atan2(H / 2 - pos.y, W / 2 - pos.x) + rnd(-0.5, 0.5),
      speed: rnd(45, 78),
      turn: 0,
      nextTurn: 0,
      squish: 1,
    });
  }

  /** tips: [{x, y}] 검지 끝 좌표(픽셀) */
  update(dt, W, H, tips, t) {
    const target = Math.min(14, 10 + Math.floor(this.score / 15));
    this.spawnAcc += dt;
    if (this.roaches.length < target && this.spawnAcc > 200) {
      this.spawnAcc = 0;
      this.spawn(W, H);
    }

    const sec = dt / 1000;
    const margin = Math.min(W, H) * 0.12;

    for (let i = this.roaches.length - 1; i >= 0; i--) {
      const r = this.roaches[i];

      // 손가락이 가까우면 도망가고, 닿으면 잡힌다
      let fleeX = 0, fleeY = 0, panic = 0;
      let caught = false;
      for (const tip of tips) {
        const dx = r.x - tip.x, dy = r.y - tip.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < r.size * 0.55) { caught = true; break; }
        const fleeR = r.size * 3.2;
        if (d < fleeR) {
          const w = (1 - d / fleeR) ** 2;
          fleeX += (dx / d) * w;
          fleeY += (dy / d) * w;
          panic = Math.max(panic, w);
        }
      }

      if (caught) {
        this.kill(i, t);
        continue;
      }

      if (panic > 0.01) {
        const want = Math.atan2(fleeY, fleeX);
        let diff = ((want - r.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        r.angle += diff * Math.min(1, sec * 9 * panic);
      } else {
        // 평소엔 잠깐씩 방향을 바꾸며 어슬렁거린다
        r.nextTurn -= dt;
        if (r.nextTurn <= 0) {
          r.nextTurn = rnd(250, 900);
          r.turn = rnd(-2.2, 2.2);
        }
        r.angle += r.turn * sec;
      }

      const speed = r.speed * (1 + panic * 1.8);
      r.x += Math.cos(r.angle) * speed * sec;
      r.y += Math.sin(r.angle) * speed * sec;

      // 화면 밖으로 나가려 하면 안쪽으로 되돌린다
      if (r.x < margin || r.x > W - margin || r.y < margin || r.y > H - margin) {
        const want = Math.atan2(H / 2 - r.y, W / 2 - r.x);
        let diff = ((want - r.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        r.angle += diff * Math.min(1, sec * 3);
        r.x = Math.max(-r.size, Math.min(W + r.size, r.x));
        r.y = Math.max(-r.size, Math.min(H + r.size, r.y));
      }
    }

    // 파편 물리 — 강한 드래그로 200ms 안에 멈춰 얼룩이 된다
    const drag = Math.pow(0.02, sec);
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const sp = this.splats[i];
      if (t - sp.born > 2600) { this.splats.splice(i, 1); continue; }
      for (const p of sp.parts) {
        p.x += p.vx * sec;
        p.y += p.vy * sec;
        p.rot += p.vr * sec;
        p.vx *= drag;
        p.vy *= drag;
        p.vr *= drag;
      }
    }
    if (this.flash > 0) this.flash -= dt;
  }

  kill(index, t) {
    const r = this.roaches.splice(index, 1)[0];
    this.score++;
    this.flash = 220;

    // 파편과 즙을 사방으로 날린다 (드래그가 커서 금방 멈추고 얼룩으로 남는다)
    const parts = [];
    for (let i = 0; i < 30; i++) {
      const a = rnd(0, Math.PI * 2);
      const sp = rnd(1.6, 9.5) * r.size;
      const kind = i % 5 === 0 ? "shell" : i % 3 === 0 ? "guts" : "juice";
      parts.push({
        x: 0, y: 0,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: kind === "shell" ? rnd(0.06, 0.11) : rnd(0.05, 0.15),
        elong: 1 + sp / (r.size * 4),   // 빠를수록 길게 늘어난 자국
        rot: rnd(0, Math.PI * 2), vr: rnd(-14, 14),
        kind,
      });
    }

    this.splats.push({
      x: r.x, y: r.y, size: r.size, angle: r.angle, born: t, parts,
      lobes: Array.from({ length: 11 }, () => rnd(0.75, 1.5)),
      legs: Array.from({ length: 6 }, (_, i) => ({
        a: (i / 6) * Math.PI * 2 + rnd(-0.4, 0.4),
        len: rnd(0.7, 1.15),
        bend: rnd(-0.3, 0.3),
      })),
    });
    crunch();
  }

  draw(ctx, W, H, tips, t) {
    for (const sp of this.splats) {
      drawSplat(ctx, sp, (t - sp.born) / 2600);
    }
    for (const r of this.roaches) {
      drawRoach(ctx, r, t);
    }

    // 검지 끝 조준점
    for (const tip of tips) {
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, Math.min(W, H) * 0.014, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(34,211,238,0.28)";
      ctx.fill();
      ctx.strokeStyle = "rgba(34,211,238,0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${(this.flash / 220) * 0.16})`;
      ctx.fillRect(0, 0, W, H);
    }

    // 점수 — 글자가 뒤집히지 않도록 미러 해제
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const fs = Math.round(H * 0.06);
    ctx.font = `700 ${fs}px "Courier New", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = fs * 0.14;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.fillStyle = "#fde047";
    const label = `CAUGHT  ${this.score}`;
    ctx.strokeText(label, W / 2, H * 0.03);
    ctx.fillText(label, W / 2, H * 0.03);
    ctx.restore();
  }
}

/** 핸드 트래킹 결과에서 검지 끝 좌표(픽셀)를 뽑아낸다 (양손이면 2개) */
export function fingertipsOf(result, W, H) {
  const tips = [];
  for (const lm of result?.landmarks ?? []) {
    for (const i of TIPS) {
      const p = lm[i];
      if (p) tips.push({ x: p.x * W, y: p.y * H });
    }
  }
  return tips;
}
