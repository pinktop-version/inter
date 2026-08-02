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
import { FingerMessage } from "./fingers.js";

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
const fingerMsgEl = document.getElementById("fingerMsg");
const withAudio = document.getElementById("withAudio");
const recDot = document.getElementById("recDot");
const recTime = document.getElementById("recTime");

// 효과 → 필요한 모델 (바퀴벌레 게임은 핸드 트래킹을 재사용한다)
// 효과마다 필요한 모델. 손가락 메시지는 손과 얼굴을 함께 쓴다.
const TASKS_FOR = {
  hand: ["hand"],
  face: ["face"],
  body: ["body"],
  roach: ["hand"],
  finger: ["hand", "face"],
};
const TASK_OF = { hand: "hand", face: "face", body: "body", roach: "hand", finger: "hand" };

let effect = "hand";
let running = false;
let lastTs = -1;
let lastFrame = 0;
const lastResults = {};     // 모델별 마지막 추론 결과
const lastVideoTimes = {};  // 모델별로 마지막에 처리한 영상 시각
let loopError = false;
const game = new RoachGame();
const fingerMsg = new FingerMessage();
let vision = null;
const tasks = {};          // 효과별 지연 로딩된 모델
const loading = {};        // 중복 로딩 방지
const maskCanvas = document.createElement("canvas");
let hasMask = false;

const setStatus = (msg) => {
  statusEl.hidden = !msg;
  statusEl.textContent = msg ?? "";
};

// 인식이 되고 있는지 눈으로 확인할 수 있게 알려준다 (DOM 오버레이라 녹화엔 안 찍힌다)
const detectEl = document.getElementById("detect");
let lastDetectText = "";
let fpsCount = 0, fpsSince = 0, fps = 0;

let missSince = 0;
let missShown = false;

function reportDetection(count, label) {
  const now = performance.now();
  fpsCount++;
  if (now - fpsSince >= 500) {
    fps = Math.round((fpsCount * 1000) / (now - fpsSince));
    fpsCount = 0;
    fpsSince = now;
  }

  // 인식이 계속 안 되면 원인 파악에 필요한 값을 알아서 보여준다
  if (count > 0) {
    missSince = 0;
    if (missShown) { note(null); missShown = false; }
  } else {
    if (!missSince) missSince = now;
    if (!missShown && now - missSince > 4000) {
      missShown = true;
      const kind = TASK_OF[effect];
      note(
        `인식 실패 진단 — 모드 ${runMode[kind]} / 캔버스 ${canvas.width}x${canvas.height} / ` +
        `영상 ${video.videoWidth}x${video.videoHeight} (readyState ${video.readyState}) / ` +
        `${fps}fps / 재시작 ${failures[kind] ?? 0}회`
      );
    }
  }

  const text = `${count > 0 ? `${label} ${count} 인식됨` : `${label} 인식 안 됨`} · ${fps}fps`;
  if (text === lastDetectText) return;
  lastDetectText = text;
  detectEl.textContent = text;
  detectEl.classList.toggle("off", count === 0);
  detectEl.hidden = false;
}

// 디버그 모드: 앱이 얼굴을 화면 어디로 인식하는지 실제 픽셀 값으로 보여준다
const debugEl = document.getElementById("debug");
let geomAt = 0;
function reportGeometry(lm, W, H) {
  const now = performance.now();
  if (now - geomAt < 500) return;
  geomAt = now;
  if (!lm) {
    note(`캔버스 ${W}x${H} / 영상 ${video.videoWidth}x${video.videoHeight} / 얼굴 없음`);
    return;
  }
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of lm) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  note(
    `캔버스 ${W}x${H} / 영상 ${video.videoWidth}x${video.videoHeight} / 점 ${lm.length}개 / ` +
    `얼굴 ${Math.round(x0 * W)},${Math.round(y0 * H)} ~ ${Math.round(x1 * W)},${Math.round(y1 * H)} ` +
    `(${Math.round((x1 - x0) * W)}x${Math.round((y1 - y0) * H)}px)`
  );
}

// 폰에서는 콘솔을 볼 수 없으므로 진단 메시지를 화면에 남긴다
const noteEl = document.getElementById("note");
function note(msg) {
  if (!noteEl) return;
  noteEl.hidden = !msg;
  noteEl.textContent = msg ?? "";
}

/** 카메라 열기 — 안드로이드는 facingMode가 없으면 후면 카메라가 잡힌다 */
async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      location.protocol === "https:" || location.hostname === "localhost"
        ? "이 브라우저는 카메라를 지원하지 않습니다. 카카오톡·인스타 등 앱 안에서 열었다면 Chrome으로 열어주세요."
        : "https 주소로 접속해야 카메라를 쓸 수 있습니다."
    );
  }
  const attempts = [
    { video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } },
    { video: { facingMode: "user" } },
    { video: true },
  ];
  let lastErr;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
      console.warn("getUserMedia 실패:", constraints, err);
    }
  }
  throw lastErr;
}

/* ── 모델 지연 로딩 ──────────────────────────────────── */

// VIDEO 모드는 이전 프레임의 추적 영역(ROI)을 이어받는데, 이 값이 NaN으로 깨지면
// 그래프가 영구히 실패한다. 그때는 IMAGE 모드로 내려간다 — 매 프레임 새로 검출하므로
// 이어받는 상태가 없어 같은 오류가 날 수 없다.
const runMode = { hand: "VIDEO", face: "VIDEO", body: "VIDEO" };

function createTask(kind, delegate) {
  const baseOptions = { modelAssetPath: MODELS[kind], delegate };
  const runningMode = runMode[kind];
  // 기본 임계값(0.5)은 웹캠 화질·조명에서 놓치는 경우가 많아 낮춘다
  if (kind === "hand") {
    return HandLandmarker.createFromOptions(vision, {
      baseOptions, runningMode, numHands: 2,
      minHandDetectionConfidence: 0.3,
      minHandPresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
  }
  if (kind === "face") {
    return FaceLandmarker.createFromOptions(vision, {
      baseOptions, runningMode, numFaces: 1,
      minFaceDetectionConfidence: 0.3,
      minFacePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
  }
  return ImageSegmenter.createFromOptions(vision, {
    baseOptions, runningMode, outputCategoryMask: true,
  });
}

/* ── 추론 실패 복구 ──────────────────────────────────── */

const failures = {};
const rebuilding = {};

// 추론 그래프가 깨졌을 때 새 인스턴스로 교체한다. 교체가 끝날 때까지는
// 기존 태스크를 그대로 두고 결과만 건너뛰어 화면이 깜빡이지 않게 한다.
function recoverTask(kind, err) {
  if (rebuilding[kind]) return;
  rebuilding[kind] = true;
  failures[kind] = (failures[kind] ?? 0) + 1;

  const downgrade = failures[kind] >= 2 && runMode[kind] === "VIDEO";
  if (downgrade) runMode[kind] = "IMAGE";
  note(
    downgrade
      ? `추적 그래프가 반복 실패해 IMAGE 모드로 전환합니다 (${kind})`
      : `추적 그래프 오류로 재시작합니다 (${kind}): ${err.message.slice(0, 80)}`
  );

  const old = tasks[kind];
  createTask(kind, "GPU")
    .catch(() => createTask(kind, "CPU"))
    .then((fresh) => {
      tasks[kind] = fresh;
      delete lastResults[kind];
      delete lastVideoTimes[kind];
      try { old?.close?.(); } catch { /* 정리 실패는 무시 */ }
      if (failures[kind] < 2) note(null);
    })
    .catch((e) => note(`추적기 재시작 실패 (${kind}): ${e.message}`))
    .finally(() => { rebuilding[kind] = false; });
}

/** 추론 실행 — 실패하면 복구를 걸고 null을 돌려준다 */
function runDetect(kind, task, ts) {
  try {
    const res = runMode[kind] === "IMAGE"
      ? task.detect(video)
      : task.detectForVideo(video, ts);
    failures[kind] = 0;
    return res;
  } catch (err) {
    console.error(`${kind} 추론 실패:`, err);
    recoverTask(kind, err);
    return null;
  }
}

async function getTask(kind) {
  if (tasks[kind]) return tasks[kind];
  if (loading[kind]) return loading[kind];

  loading[kind] = (async () => {
    if (!vision) vision = await FilesetResolver.forVisionTasks(WASM);
    let task;
    try {
      task = await createTask(kind, "GPU");
    } catch (err) {
      // 일부 안드로이드 GPU에서는 WebGL 델리게이트 생성이 실패한다
      console.warn("GPU 델리게이트 실패, CPU로 전환:", err);
      note(`GPU 가속 불가 → CPU 모드 (${err.name || "오류"})`);
      task = await createTask(kind, "CPU");
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
    const stream = await openCamera();
    video.srcObject = stream;
    await video.play();

    // 일부 기기는 play() 직후에도 해상도가 0이라 메타데이터를 기다려야 한다
    if (!video.videoWidth) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("카메라 영상이 시작되지 않았습니다")), 8000);
        video.addEventListener("loadedmetadata", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    setStatus("모델 불러오는 중…");
    await Promise.all(TASKS_FOR[effect].map(getTask));

    setStatus(null);
    running = true;
    btnRec.disabled = false;
    btnShot.disabled = false;
    btnStart.textContent = "카메라 실행 중";
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    setStatus(`시작 실패: ${err.message}`);
    note(`${err.name || "Error"}: ${err.message} / ${navigator.userAgent}`);
    btnStart.disabled = false;
    btnStart.textContent = "다시 시도";
  }
});

/* ── 효과 전환 ───────────────────────────────────────── */

document.querySelectorAll(".fx").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".fx").forEach((b) => b.classList.remove("is-on"));
    btn.classList.add("is-on");
    effect = btn.dataset.fx;
    hasMask = false;
    loopError = false;
    if (effect === "roach") game.reset();
    if (effect === "finger") fingerMsg.reset();
    if (running && !TASKS_FOR[effect].every((k) => tasks[k])) {
      setStatus("모델 불러오는 중…");
      await Promise.all(TASKS_FOR[effect].map(getTask));
      setStatus(null);
    }
  });
});

/* ── 렌더 루프 ───────────────────────────────────────── */

function loop() {
  if (!running) return;

  // 화면 회전 등으로 카메라 해상도가 바뀌면 캔버스를 맞춘다
  // (녹화 중에는 스트림이 끊기므로 건드리지 않는다)
  if (!recorder && video.videoWidth &&
      (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    for (const k of Object.keys(lastResults)) delete lastResults[k];
  }

  const W = canvas.width, H = canvas.height;
  const needed = TASKS_FOR[effect];
  const task = needed.every((k) => tasks[k]) ? tasks[TASK_OF[effect]] : null;

  // 셀피 미러링: 이후 모든 그리기는 비디오 원본 좌표계에서 이뤄진다.
  ctx.setTransform(-1, 0, 0, 1, W, 0);

  if (!task) {
    ctx.drawImage(video, 0, 0, W, H);
  } else {
    let ts = performance.now();
    if (ts <= lastTs) ts = lastTs + 1;   // 타임스탬프는 반드시 증가해야 한다
    lastTs = ts;

    // 같은 영상 프레임을 반복해서 넣으면 VIDEO 모드의 트래킹 상태가 흐트러진다.
    // 카메라가 새 프레임을 준 경우에만 추론하고, 그 사이엔 직전 결과를 재사용한다.
    // 영상 프레임이 아직 준비되지 않았는데 추론을 호출하면 내부에서 ROI가
    // NaN이 되어 그래프가 영구히 깨진다. 준비된 프레임에서만 추론한다.
    const ready = video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
    const fresh = ready && video.currentTime !== lastVideoTimes.__frame;
    if (fresh) lastVideoTimes.__frame = video.currentTime;

    // 모델별로 추론하고 결과를 캐싱한다. 실패해도 직전 결과를 유지해 화면이 흔들리지 않는다.
    const detectOf = (kind) => {
      if (ready && (fresh || !lastResults[kind])) {
        const res = runDetect(kind, tasks[kind], ts);
        if (res) lastResults[kind] = res;
      }
      return lastResults[kind] ?? {};
    };
    const detect = () => detectOf(TASK_OF[effect]);

    try {
      if (effect === "hand") {
        const res = detect();
        reportDetection(res.landmarks?.length ?? 0, "손");
        drawHandEffect(ctx, video, W, H, res);
      } else if (effect === "finger") {
        const hands = detectOf("hand");
        const face = detectOf("face");
        reportDetection(hands.landmarks?.length ?? 0, "손");
        fingerMsg.draw(ctx, video, W, H, hands, face, FaceLandmarker, fingerMsgEl.value, ts);
      } else if (effect === "roach") {
        const dt = Math.min(64, lastFrame ? ts - lastFrame : 16);
        const tips = fingertipsOf(detect(), W, H);
        reportDetection(tips.length, "검지");
        ctx.drawImage(video, 0, 0, W, H);
        game.update(dt, W, H, tips, ts);
        game.draw(ctx, W, H, tips, ts);
      } else if (effect === "face") {
        const res = detect();
        const faces = res.faceLandmarks ?? [];
        reportDetection(faces.length, "얼굴");
        drawFaceEffect(ctx, video, W, H, res, bgText.value, ts / 1000, FaceLandmarker, debugEl.checked);
        if (debugEl.checked) reportGeometry(faces[0], W, H);
      } else {
        if (fresh) {
          const take = (res) => {
            if (res?.categoryMask) {
              maskToCanvas(res.categoryMask, maskCanvas);
              hasMask = true;
              res.close();
            }
          };
          try {
            if (runMode.body === "IMAGE") take(task.segment(video));
            else task.segmentForVideo(video, ts, take);
          } catch (err) {
            console.error("body 추론 실패:", err);
            recoverTask("body", err);
          }
        }
        drawBodyEffect(ctx, video, W, H, hasMask ? maskCanvas : null);
      }
    } catch (err) {
      // 여기서 조용히 넘어가면 화면이 원본 영상과 효과 사이에서 깜빡이기만 하고
      // 원인을 알 수 없다. 폰에서도 보이도록 화면에 남긴다.
      console.error(err);
      if (!loopError) {
        loopError = true;
        note(`렌더 오류 [${effect}] ${err.name}: ${err.message}`);
      }
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
