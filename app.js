import {
  FilesetResolver,
  HandLandmarker,
  FaceLandmarker,
  ImageSegmenter,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1";

import {
  drawHandEffect,
  drawFaceEffect,
  drawBodyEffect,
  maskToCanvas,
} from "./effects.js";

import { RoachGame, fingertipsOf } from "./roaches.js";

const WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODELS = {
  hand: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  face: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  body: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
};

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("status");
const btnStart = document.getElementById("btnStart");
const btnRec = document.getElementById("btnRec");
const btnShot = document.getElementById("btnShot");
const bgText = document.getElementById("bgText");
const withAudio = document.getElementById("withAudio");
const recDot = document.getElementById("recDot");
const recTime = document.getElementById("recTime");

// 효과 → 필요한 모델 (바퀴벌레 게임은 핸드 트래킹을 재사용한다)
const TASK_OF = { hand: "hand", face: "face", body: "body", roach: "hand" };

let effect = "hand";
let running = false;
let lastTs = -1;
let lastFrame = 0;
const game = new RoachGame();
let vision = null;
const tasks = {};          // 효과별 지연 로딩된 모델
const loading = {};        // 중복 로딩 방지
const maskCanvas = document.createElement("canvas");
let hasMask = false;

const setStatus = (msg) => {
  statusEl.hidden = !msg;
  statusEl.textContent = msg ?? "";
};

/* ── 모델 지연 로딩 ──────────────────────────────────── */

async function getTask(kind) {
  if (tasks[kind]) return tasks[kind];
  if (loading[kind]) return loading[kind];

  loading[kind] = (async () => {
    if (!vision) vision = await FilesetResolver.forVisionTasks(WASM);
    const baseOptions = { modelAssetPath: MODELS[kind], delegate: "GPU" };
    let task;
    if (kind === "hand") {
      task = await HandLandmarker.createFromOptions(vision, {
        baseOptions, runningMode: "VIDEO", numHands: 2,
      });
    } else if (kind === "face") {
      task = await FaceLandmarker.createFromOptions(vision, {
        baseOptions, runningMode: "VIDEO", numFaces: 1,
      });
    } else {
      task = await ImageSegmenter.createFromOptions(vision, {
        baseOptions, runningMode: "VIDEO", outputCategoryMask: true,
      });
    }
    tasks[kind] = task;
    return task;
  })();

  return loading[kind];
}

/* ── 카메라 ──────────────────────────────────────────── */

btnStart.addEventListener("click", async () => {
  btnStart.disabled = true;
  setStatus("카메라 권한 요청 중…");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 960 } },
    });
    video.srcObject = stream;
    await video.play();

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    setStatus("모델 불러오는 중…");
    await getTask(TASK_OF[effect]);

    setStatus(null);
    running = true;
    btnRec.disabled = false;
    btnShot.disabled = false;
    btnStart.textContent = "카메라 실행 중";
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    setStatus(`시작 실패: ${err.message}`);
    btnStart.disabled = false;
  }
});

/* ── 효과 전환 ───────────────────────────────────────── */

document.querySelectorAll(".fx").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".fx").forEach((b) => b.classList.remove("is-on"));
    btn.classList.add("is-on");
    effect = btn.dataset.fx;
    hasMask = false;
    if (effect === "roach") game.reset();
    if (running && !tasks[TASK_OF[effect]]) {
      setStatus("모델 불러오는 중…");
      await getTask(TASK_OF[effect]);
      setStatus(null);
    }
  });
});

/* ── 렌더 루프 ───────────────────────────────────────── */

function loop() {
  if (!running) return;

  const W = canvas.width, H = canvas.height;
  const task = tasks[TASK_OF[effect]];

  // 셀피 미러링: 이후 모든 그리기는 비디오 원본 좌표계에서 이뤄진다.
  ctx.setTransform(-1, 0, 0, 1, W, 0);

  if (!task) {
    ctx.drawImage(video, 0, 0, W, H);
  } else {
    let ts = performance.now();
    if (ts <= lastTs) ts = lastTs + 1;   // 타임스탬프는 반드시 증가해야 한다
    lastTs = ts;

    try {
      if (effect === "hand") {
        drawHandEffect(ctx, video, W, H, task.detectForVideo(video, ts));
      } else if (effect === "roach") {
        const dt = Math.min(64, lastFrame ? ts - lastFrame : 16);
        const tips = fingertipsOf(task.detectForVideo(video, ts), W, H);
        ctx.drawImage(video, 0, 0, W, H);
        game.update(dt, W, H, tips, ts);
        game.draw(ctx, W, H, tips, ts);
      } else if (effect === "face") {
        drawFaceEffect(
          ctx, video, W, H,
          task.detectForVideo(video, ts),
          bgText.value, ts / 1000, FaceLandmarker
        );
      } else {
        task.segmentForVideo(video, ts, (res) => {
          if (res.categoryMask) {
            maskToCanvas(res.categoryMask, maskCanvas);
            hasMask = true;
            res.close();
          }
        });
        drawBodyEffect(ctx, video, W, H, hasMask ? maskCanvas : null);
      }
    } catch (err) {
      console.error(err);
      ctx.drawImage(video, 0, 0, W, H);
    }
    lastFrame = ts;
  }

  requestAnimationFrame(loop);
}

/* ── 녹화 (효과가 합성된 캔버스를 그대로 저장) ───────── */

let recorder = null;
let starting = false;
let recStart = 0;
let recTimer = null;

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function startRecording() {
  const stream = canvas.captureStream(30);

  if (withAudio.checked) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch (err) {
      console.warn("마이크 사용 불가:", err);
    }
  }

  const mimeType = pickMimeType();
  // onstop은 stopRecording()이 recorder를 비운 뒤에 실행되므로 지역 변수로 캡처한다.
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const parts = [];
  recorder = rec;

  rec.ondataavailable = (e) => {
    if (e.data.size > 0) parts.push(e.data);
  };

  rec.onstop = () => {
    const type = rec.mimeType || "video/webm";
    const ext = type.includes("mp4") ? "mp4" : "webm";
    stream.getTracks().forEach((t) => t.stop()); // 캔버스 트랙 + 마이크 트랙 정리
    if (parts.length) {
      download(new Blob(parts, { type }), `artwork-${effect}-${stamp()}.${ext}`);
    }
  };

  rec.start();
  recStart = Date.now();
  recDot.hidden = false;
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    recTime.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 250);

  btnRec.textContent = "■ 녹화 정지 · 저장";
  btnRec.classList.add("recording");
}

function stopRecording() {
  if (recorder && recorder.state !== "inactive") recorder.stop();
  recorder = null;
  clearInterval(recTimer);
  recDot.hidden = true;
  recTime.textContent = "0:00";
  btnRec.textContent = "● 녹화 시작";
  btnRec.classList.remove("recording");
}

btnRec.addEventListener("click", async () => {
  if (recorder) return stopRecording();
  if (starting) return;               // 마이크 권한 대기 중 중복 클릭 방지
  starting = true;
  try {
    await startRecording();
  } catch (err) {
    console.error(err);
    setStatus(`녹화 실패: ${err.message}`);
  } finally {
    starting = false;
  }
});

btnShot.addEventListener("click", () => {
  canvas.toBlob((blob) => {
    if (blob) download(blob, `artwork-${effect}-${stamp()}.png`);
  }, "image/png");
});
