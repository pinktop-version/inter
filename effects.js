// 챕터 4/5/6에 대응하는 세 가지 캔버스 효과.
// 호출 시점의 ctx 트랜스폼은 셀피 미러링 상태이며, 좌표계는 비디오 원본 픽셀 기준이다.

const seeded = (i) => {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

function boundsOf(landmarks, W, H, pad) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = (maxX - minX) * W, h = (maxY - minY) * H;
  const sx = minX * W - w * pad;
  const sy = minY * H - h * pad;
  const sw = w * (1 + pad * 2);
  const sh = h * (1 + pad * 2);
  return {
    sx: Math.max(0, sx),
    sy: Math.max(0, sy),
    sw: Math.min(sw, W - Math.max(0, sx)),
    sh: Math.min(sh, H - Math.max(0, sy)),
  };
}

/* ── Chapter 4 : 핸드 복제 ────────────────────────────── */

export function drawHandEffect(ctx, video, W, H, result) {
  ctx.drawImage(video, 0, 0, W, H);
  const hands = result?.landmarks ?? [];
  const COPIES = 14;

  for (let h = 0; h < hands.length; h++) {
    const b = boundsOf(hands[h], W, H, 0.3);
    if (b.sw < 8 || b.sh < 8) continue;

    const cx = b.sx + b.sw / 2;
    const cy = b.sy + b.sh / 2;
    const reach = Math.max(b.sw, b.sh);

    for (let i = 0; i < COPIES; i++) {
      const s = i + h * 100;
      const angle = (i / COPIES) * Math.PI * 2 + seeded(s) * 0.5;
      const dist = reach * (0.55 + seeded(s + 31) * 1.15);
      const scale = 0.7 - (i / COPIES) * 0.4 + seeded(s + 57) * 0.2;

      ctx.save();
      ctx.globalAlpha = 0.9 - (i / COPIES) * 0.45;
      ctx.translate(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist);
      ctx.rotate(angle + Math.PI / 2);
      ctx.drawImage(
        video, b.sx, b.sy, b.sw, b.sh,
        -b.sw * scale / 2, -b.sh * scale / 2, b.sw * scale, b.sh * scale
      );
      ctx.restore();
    }
  }
}

/* ── Chapter 5 : 페이스 컷아웃 + 텍스트 배경 ──────────── */

// FACE_OVAL 커넥션 배열({start,end})을 하나의 닫힌 경로 순서로 정렬한다.
let ovalOrder = null;

function faceOvalOrder(connections) {
  if (ovalOrder) return ovalOrder;
  const next = new Map(connections.map((c) => [c.start, c.end]));
  const order = [];
  let node = connections[0].start;
  for (let i = 0; i < connections.length; i++) {
    order.push(node);
    node = next.get(node);
    if (node === undefined || node === order[0]) break;
  }
  ovalOrder = order;
  return order;
}

// 매 프레임 fillText를 수십 번 호출하면 모바일에서 프레임이 급락한다.
// 반복 단위를 타일 캔버스에 한 번만 그려두고 패턴으로 채운다.
let tile = null, tileKey = "", tileW = 1, tileH = 1;

function textTile(text, size) {
  const key = `${text}|${size}`;
  if (tileKey === key) return tile;

  const probe = document.createElement("canvas").getContext("2d");
  const font = `600 ${size}px "Courier New", monospace`;
  probe.font = font;
  const line = `${text}   `;
  const unit = Math.max(1, Math.ceil(probe.measureText(line).width));
  const step = Math.ceil(size * 1.45);

  const t = document.createElement("canvas");
  t.width = unit;
  t.height = step * 2;               // 두 줄을 엇갈리게 배치해 반복 티가 덜 난다
  const c = t.getContext("2d");
  c.font = font;
  c.fillStyle = "rgba(255,255,255,0.82)";
  c.textBaseline = "top";
  for (const [y, dx] of [[0, 0], [step, unit / 2]]) {
    c.fillText(line, dx, y);
    c.fillText(line, dx - unit, y);  // 이음매가 끊기지 않도록 한 벌 더
  }

  tile = t; tileKey = key; tileW = unit; tileH = step * 2;
  return tile;
}

export function drawTextBackground(ctx, W, H, text, phase) {
  const size = Math.max(13, Math.round(H / 34));
  const t = textTile(text, size);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // 텍스트는 좌우 반전되지 않도록 미러 해제
  ctx.fillStyle = "#0b0b0b";
  ctx.fillRect(0, 0, W, H);

  const offX = -((phase * 28) % tileW);
  const pattern = ctx.createPattern(t, "repeat");
  ctx.setTransform(1, 0, 0, 1, offX, 0);
  ctx.fillStyle = pattern;
  ctx.fillRect(-offX, 0, W, H);
  ctx.restore();
}

// 얼굴만 오려내는 작업용 캔버스. clip()은 일부 모바일 GPU에서 트랜스폼과 함께
// 쓸 때 결과가 비어버리는 경우가 있어, 합성 연산(source-in)으로 대체한다.
const faceCut = document.createElement("canvas");
const fctx = faceCut.getContext("2d");

function faceOvalPath(target, lm, order, W, H) {
  target.beginPath();
  order.forEach((idx, i) => {
    const p = lm[idx];
    const x = p.x * W, y = p.y * H;
    i === 0 ? target.moveTo(x, y) : target.lineTo(x, y);
  });
  target.closePath();
}

export function drawFaceEffect(ctx, video, W, H, result, text, phase, FaceLandmarker, debug) {
  drawTextBackground(ctx, W, H, text, phase);

  const faces = result?.faceLandmarks ?? [];
  if (!faces.length) return;

  const order = faceOvalOrder(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL);

  if (faceCut.width !== W || faceCut.height !== H) {
    faceCut.width = W;
    faceCut.height = H;
  }
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.clearRect(0, 0, W, H);

  // 얼굴 윤곽을 채워 마스크를 만든 뒤, 그 안쪽만 영상으로 바꿔치기한다
  fctx.fillStyle = "#fff";
  for (const lm of faces) {
    faceOvalPath(fctx, lm, order, W, H);
    fctx.fill();
  }
  fctx.globalCompositeOperation = "source-in";
  fctx.drawImage(video, 0, 0, W, H);
  fctx.globalCompositeOperation = "source-over";

  // 미러 트랜스폼이 걸린 본 캔버스에 그대로 얹는다
  ctx.save();
  ctx.shadowColor = "rgba(255,255,255,0.55)";
  ctx.shadowBlur = Math.round(W / 45);
  ctx.drawImage(faceCut, 0, 0, W, H);
  ctx.restore();

  if (debug) {
    ctx.save();
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = Math.max(2, W / 200);
    for (const lm of faces) {
      faceOvalPath(ctx, lm, order, W, H);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ── Chapter 6 : 바디 글로우 ──────────────────────────── */

const glow = document.createElement("canvas");
const gctx = glow.getContext("2d");

export function drawBodyEffect(ctx, video, W, H, maskCanvas, color = "#5eead4") {
  ctx.drawImage(video, 0, 0, W, H);
  if (!maskCanvas) return;

  if (glow.width !== W || glow.height !== H) {
    glow.width = W;
    glow.height = H;
  }
  gctx.setTransform(1, 0, 0, 1, 0, 0);
  gctx.clearRect(0, 0, W, H);

  // 실루엣을 블러 그림자와 함께 여러 번 그려 빛을 누적시킨다.
  gctx.shadowColor = color;
  gctx.shadowBlur = Math.round(W / 45);
  for (let i = 0; i < 3; i++) gctx.drawImage(maskCanvas, 0, 0, W, H);

  // 실루엣 내부를 도려내면 가장자리 광채만 남는다.
  gctx.shadowBlur = 0;
  gctx.globalCompositeOperation = "destination-out";
  gctx.drawImage(maskCanvas, 0, 0, W, H);
  gctx.globalCompositeOperation = "source-over";

  ctx.drawImage(glow, 0, 0, W, H);
}

// 어떤 라벨이 배경인지는 모델마다 다르다. 프레임 위/아래 가장자리는 거의 항상
// 배경이므로, 그 줄에서 가장 흔한 라벨을 배경으로 간주한다.
function backgroundLabel(data, w, h) {
  const count = new Map();
  const rows = [0, h - 1];
  for (const y of rows) {
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      count.set(v, (count.get(v) ?? 0) + 1);
    }
  }
  let best = 0, bestN = -1;
  for (const [v, n] of count) if (n > bestN) { best = v; bestN = n; }
  return best;
}

/** 세그멘테이션 카테고리 마스크를 흰 실루엣 캔버스로 변환 */
export function maskToCanvas(mask, out) {
  const w = mask.width, h = mask.height;
  const data = mask.getAsUint8Array();
  if (out.width !== w || out.height !== h) {
    out.width = w;
    out.height = h;
  }
  const bg = backgroundLabel(data, w, h);
  const octx = out.getContext("2d");
  const img = octx.createImageData(w, h);
  const px = img.data;
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    if (data[i] !== bg) {
      px[j] = px[j + 1] = px[j + 2] = px[j + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}
