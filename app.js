const startBtn   = document.getElementById('start-btn');
const stopBtn    = document.getElementById('stop-btn');
const restartBtn = document.getElementById('restart-btn');
const meterBar   = document.getElementById('meter-bar');
const dbValue    = document.getElementById('db-value');
const errorMsg   = document.getElementById('error-msg');
const historyCanvas = document.getElementById('history-canvas');
const histCtx = historyCanvas.getContext('2d');

const DB_MIN = -60;
const DB_MAX = 0;
const SAMPLE_INTERVAL_MS = 100; // 10 Hz → 300 samples = 30 s
const MAX_HISTORY = 300;

// Anchor points matching the evenly-spaced scale labels (0,-3,-6,-10,-20,-40,-60)
// pos 0 = bottom, 1 = top
const SCALE_ANCHORS = [
  { db: -60, pos: 0 },
  { db: -40, pos: 1/6 },
  { db: -20, pos: 2/6 },
  { db: -10, pos: 3/6 },
  { db:  -6, pos: 4/6 },
  { db:  -3, pos: 5/6 },
  { db:   0, pos: 1   },
];

function dbToPos(db) {
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
  for (let i = 1; i < SCALE_ANCHORS.length; i++) {
    const a = SCALE_ANCHORS[i - 1], b = SCALE_ANCHORS[i];
    if (clamped <= b.db) {
      const t = (clamped - a.db) / (b.db - a.db);
      return a.pos + t * (b.pos - a.pos);
    }
  }
  return 1;
}

// Set canvas pixel size to match its CSS size
historyCanvas.width = 320;
historyCanvas.height = 100;

const history = [];
let lastSampleTime = 0;
let animFrameId = null;
let currentStream = null;
let currentAudioCtx = null;

function drawHistory() {
  const W = historyCanvas.width;
  const H = historyCanvas.height;
  const LW = 28; // left margin reserved for scale labels

  // Background
  histCtx.fillStyle = '#2a2a2a';
  histCtx.fillRect(0, 0, W, H);

  // Scale labels + grid lines
  histCtx.font = '9px monospace';
  histCtx.textAlign = 'right';
  [-60, -40, -20, -10, -6, -3, 0].forEach(level => {
    const y = H - dbToPos(level) * H;
    // Grid line (chart area only)
    histCtx.strokeStyle = '#3a3a3a';
    histCtx.lineWidth = 1;
    histCtx.beginPath();
    histCtx.moveTo(LW, y);
    histCtx.lineTo(W, y);
    histCtx.stroke();
    // Label
    histCtx.fillStyle = '#555';
    histCtx.textBaseline = level === DB_MIN ? 'bottom' : level === DB_MAX ? 'top' : 'middle';
    histCtx.fillText(level, LW - 3, y);
  });

  if (history.length < 2) return;

  // Gradient: green at bottom → red at top
  const grad = histCtx.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0,    '#00c853');
  grad.addColorStop(0.5,  '#00c853');
  grad.addColorStop(0.7,  '#ffd600');
  grad.addColorStop(0.85, '#ff6d00');
  grad.addColorStop(1,    '#d50000');

  // Filled area chart
  const CW = W - LW;
  histCtx.beginPath();
  history.forEach((db, i) => {
    const x = LW + (i / (MAX_HISTORY - 1)) * CW;
    const y = H - dbToPos(isFinite(db) ? db : DB_MIN) * H;
    if (i === 0) histCtx.moveTo(x, y);
    else histCtx.lineTo(x, y);
  });
  const lastX = LW + ((history.length - 1) / (MAX_HISTORY - 1)) * CW;
  histCtx.lineTo(lastX, H);
  histCtx.lineTo(LW, H);
  histCtx.closePath();
  histCtx.fillStyle = grad;
  histCtx.fill();

  // Max value line + label
  const maxDb = history.reduce((m, v) => Math.max(m, v), -Infinity);
  const maxY = H - dbToPos(maxDb) * H;

  histCtx.strokeStyle = 'rgba(255,255,255,0.55)';
  histCtx.lineWidth = 1;
  histCtx.setLineDash([4, 3]);
  histCtx.beginPath();
  histCtx.moveTo(LW, maxY);
  histCtx.lineTo(W, maxY);
  histCtx.stroke();
  histCtx.setLineDash([]);

  // Label: above the line normally, below if too close to top
  histCtx.font = 'bold 9px monospace';
  histCtx.fillStyle = 'rgba(255,255,255,0.75)';
  histCtx.textAlign = 'right';
  histCtx.textBaseline = maxY < 12 ? 'top' : 'bottom';
  histCtx.fillText(maxDb.toFixed(1), W - 2, maxY + (maxY < 12 ? 2 : -2));
}

function setRunning(running) {
  startBtn.classList.toggle('hidden', running);
  stopBtn.classList.toggle('hidden', !running);
  restartBtn.classList.toggle('hidden', true);
}

function setIdle() {
  startBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  restartBtn.classList.add('hidden');
}

function setStopped() {
  startBtn.classList.add('hidden');
  stopBtn.classList.add('hidden');
  restartBtn.classList.remove('hidden');
}

function stopMeter() {
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
  if (currentAudioCtx) { currentAudioCtx.close(); currentAudioCtx = null; }
  meterBar.style.height = '100%';
}

async function startMeter() {
  errorMsg.classList.add('hidden');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    currentStream = stream;
    currentAudioCtx = new AudioContext();
    const source = currentAudioCtx.createMediaStreamSource(stream);
    const analyser = currentAudioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);
    setRunning(true);

    function update() {
      analyser.getFloatTimeDomainData(buffer);

      let sumSq = 0;
      for (let i = 0; i < buffer.length; i++) sumSq += buffer[i] * buffer[i];
      const rms = Math.sqrt(sumSq / buffer.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

      if (isFinite(db)) {
        const pct = dbToPos(db) * 100;
        meterBar.style.height = (100 - pct) + '%';
        dbValue.textContent = Math.max(DB_MIN, Math.min(DB_MAX, db)).toFixed(1) + ' dB';
      } else {
        meterBar.style.height = '100%';
        dbValue.textContent = DB_MIN + '.0 dB';
      }

      const now = performance.now();
      if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
        lastSampleTime = now;
        history.push(isFinite(db) ? db : DB_MIN);
        if (history.length > MAX_HISTORY) history.shift();
        drawHistory();
      }

      animFrameId = requestAnimationFrame(update);
    }

    update();
  } catch (err) {
    setIdle();
    errorMsg.textContent = err.name === 'NotAllowedError'
      ? 'Microphone access denied. Please allow mic access and try again.'
      : 'Could not access microphone: ' + err.message;
    errorMsg.classList.remove('hidden');
  }
}

startBtn.addEventListener('click', () => startMeter());

stopBtn.addEventListener('click', () => {
  stopMeter();
  setStopped();
});

restartBtn.addEventListener('click', () => {
  history.length = 0;
  drawHistory();
  dbValue.textContent = '-- dB';
  startMeter();
});
