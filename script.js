const els = {
  motionMode: document.getElementById('motionMode'),
  v0: document.getElementById('v0'),
  acc: document.getElementById('acc'),
  v0Out: document.getElementById('v0Out'),
  accOut: document.getElementById('accOut'),
  customProfile: document.getElementById('customProfile'),
  customT1: document.getElementById('customT1'),
  customT2: document.getElementById('customT2'),
  customT3: document.getElementById('customT3'),
  customA1: document.getElementById('customA1'),
  customA2: document.getElementById('customA2'),
  customA3: document.getElementById('customA3'),
  customA4: document.getElementById('customA4'),
  freq: document.getElementById('freq'),
  duration: document.getElementById('duration'),
  groupSize: document.getElementById('groupSize'),
  scale: document.getElementById('scale'),
  runBtn: document.getElementById('runBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  stepBtn: document.getElementById('stepBtn'),
  simRunBtn: document.getElementById('simRunBtn'),
  simPauseBtn: document.getElementById('simPauseBtn'),
  simStepBtn: document.getElementById('simStepBtn'),
  resetBtn: document.getElementById('resetBtn'),
  togglePanelBtn: document.getElementById('togglePanelBtn'),
  toggleValuesBtn: document.getElementById('toggleValuesBtn'),
  togglePeriodBtn: document.getElementById('togglePeriodBtn'),
  clearMeasureBtn: document.getElementById('clearMeasureBtn'),
  downloadCsvBtn: document.getElementById('downloadCsvBtn'),
  tape: document.getElementById('tape'),
  ruler: document.getElementById('ruler'),
  dataBody: document.getElementById('dataBody'),
  chart: document.getElementById('chart'),
  graphType: document.getElementById('graphType'),
  cart: document.getElementById('cart'),
  needle: document.getElementById('needle'),
  motionStatus: document.getElementById('motionStatus'),
  measureResult: document.getElementById('measureResult'),
  dtSummary: document.getElementById('dtSummary'),
  dotSummary: document.getElementById('dotSummary'),
  distanceSummary: document.getElementById('distanceSummary'),
  avgSpeedSummary: document.getElementById('avgSpeedSummary'),
  interpretation: document.getElementById('interpretation'),
  qFreq: document.getElementById('qFreq'),
  ansDt: document.getElementById('ansDt'),
  ansDistance: document.getElementById('ansDistance'),
  ansType: document.getElementById('ansType'),
  checkAnswersBtn: document.getElementById('checkAnswersBtn'),
  answerFeedback: document.getElementById('answerFeedback')
};

const chartFont = '"TH Sarabun New", "Sarabun", Tahoma, Arial, sans-serif';
const chartMathFont = '"Cambria Math", "STIX Two Math", "Noto Sans Math", "DejaVu Math TeX Gyre", "Times New Roman", serif';

let state = {
  points: [],
  groups: [],
  currentIndex: 0,
  running: false,
  timer: null,
  selectedDots: [],
  panelHidden: false,
  valuesHidden: false,
  periodHidden: false
};

function readSettings() {
  let v0 = Number(els.v0.value);
  let acc = Number(els.acc.value);
  const mode = els.motionMode.value;

  if (mode === 'constant') {
    acc = 0;
  } else if (mode === 'accelerate') {
    acc = Math.abs(acc || 35);
    if (v0 < 5) v0 = 25;
  } else if (mode === 'decelerate') {
    acc = -Math.abs(acc || 35);
    if (v0 < 40) v0 = 85;
  }

  const freq = clamp(Number(els.freq.value), 10, 100);
  const duration = clamp(Number(els.duration.value), 0.4, 5);
  const groupSize = Math.round(clamp(Number(els.groupSize.value), 2, 10));
  const scale = clamp(Number(els.scale.value), 40, 100);
  const customSegments = readCustomSegments(duration);

  return { mode, v0, acc, freq, duration, groupSize, scale, customSegments };
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function readCustomSegments(duration) {
  const minStep = 0.05;
  const t1 = clamp(Number(els.customT1.value), minStep, Math.max(minStep, duration - minStep * 3));
  const t2 = clamp(Number(els.customT2.value), t1 + minStep, Math.max(t1 + minStep, duration - minStep * 2));
  const t3 = clamp(Number(els.customT3.value), t2 + minStep, Math.max(t2 + minStep, duration - minStep));
  return [
    { start: 0, end: t1, a: clamp(Number(els.customA1.value), -160, 160) },
    { start: t1, end: t2, a: clamp(Number(els.customA2.value), -160, 160) },
    { start: t2, end: t3, a: clamp(Number(els.customA3.value), -160, 160) },
    { start: t3, end: duration, a: clamp(Number(els.customA4.value), -160, 160) }
  ];
}

function accelerationAt(time, segments) {
  const segment = segments.find(item => time < item.end);
  return segment ? segment.a : segments[segments.length - 1].a;
}

function syncControlOutputs() {
  const s = readSettings();
  document.body.classList.toggle('custom-mode', s.mode === 'custom');
  els.v0.value = s.v0;
  els.acc.value = s.acc;
  els.v0Out.textContent = s.v0.toFixed(0);
  els.accOut.textContent = s.acc.toFixed(0);
  els.freq.value = s.freq;
  els.duration.value = s.duration.toFixed(1);
  els.groupSize.value = s.groupSize;
  els.scale.value = s.scale;
  els.customT1.value = s.customSegments[0].end.toFixed(1);
  els.customT2.value = s.customSegments[1].end.toFixed(1);
  els.customT3.value = s.customSegments[2].end.toFixed(1);
  els.customA1.value = s.customSegments[0].a;
  els.customA2.value = s.customSegments[1].a;
  els.customA3.value = s.customSegments[2].a;
  els.customA4.value = s.customSegments[3].a;
  els.qFreq.textContent = s.freq;
}

function generatePoints() {
  const s = readSettings();
  const dt = 1 / s.freq;
  const count = Math.floor(s.duration / dt) + 1;

  if (s.mode === 'custom') {
    generateCustomPoints(s, dt, count);
    return;
  }

  const raw = [];
  let lastX = 0;

  for (let i = 0; i < count; i++) {
    const t = i * dt;
    let x = s.v0 * t + 0.5 * s.acc * t * t;
    let v = s.v0 + s.acc * t;

    if (s.mode === 'decelerate' && v < 0) {
      const stopTime = Math.max(0, s.v0 / Math.abs(s.acc));
      x = s.v0 * stopTime + 0.5 * s.acc * stopTime * stopTime;
      v = 0;
    }

    if (x < lastX) x = lastX;
    lastX = x;

    raw.push({ index: i, t, x, v, a: s.acc });
  }

  state.points = raw;
  state.groups = buildGroups(raw, s.groupSize);
  state.currentIndex = Math.min(state.currentIndex, raw.length - 1);
}

function generateCustomPoints(settings, dt, count) {
  const raw = [{ index: 0, t: 0, x: 0, v: settings.v0, a: accelerationAt(0, settings.customSegments) }];

  for (let i = 1; i < count; i++) {
    const prev = raw[i - 1];
    const t = i * dt;
    const next = advanceCustomMotion(prev, t, settings.customSegments);
    const x = Math.max(prev.x, next.x);
    const v = next.v;
    raw.push({ index: i, t, x, v, a: accelerationAt(t, settings.customSegments) });
  }

  state.points = raw;
  state.groups = buildGroups(raw, settings.groupSize);
  state.currentIndex = Math.min(state.currentIndex, raw.length - 1);
}

function advanceCustomMotion(startPoint, targetTime, segments) {
  let time = startPoint.t;
  let x = startPoint.x;
  let v = startPoint.v;

  while (time < targetTime - 0.000001) {
    const segment = segments.find(item => time < item.end) || segments[segments.length - 1];
    const nextBoundary = Math.min(segment.end, targetTime);
    const step = nextBoundary - time;
    const nextV = v + segment.a * step;

    if (nextV < 0) {
      const stopTime = segment.a < 0 ? Math.max(0, v / Math.abs(segment.a)) : 0;
      x += v * stopTime + 0.5 * segment.a * stopTime * stopTime;
      v = 0;
    } else {
      x += v * step + 0.5 * segment.a * step * step;
      v = nextV;
    }

    time = nextBoundary;
  }

  return { x, v };
}

function buildGroups(points, groupSize) {
  const groups = [];
  let prevVelocity = null;

  for (let start = 0; start + groupSize < points.length; start += groupSize) {
    const end = start + groupSize;
    const p1 = points[start];
    const p2 = points[end];
    const ds = p2.x - p1.x;
    const dt = p2.t - p1.t;
    const vAvg = ds / dt;
    const accApprox = prevVelocity === null ? null : (vAvg - prevVelocity) / dt;
    const trend = getSpacingTrend(points, start, end);
    groups.push({
      n: groups.length + 1,
      start,
      end,
      t1: p1.t,
      t2: p2.t,
      ds,
      dt,
      vAvg,
      accApprox,
      trend
    });
    prevVelocity = vAvg;
  }

  return groups;
}

function getSpacingTrend(points, start, end) {
  const gaps = [];
  for (let i = start + 1; i <= end; i++) {
    gaps.push(points[i].x - points[i - 1].x);
  }
  const first = average(gaps.slice(0, Math.ceil(gaps.length / 2)));
  const second = average(gaps.slice(Math.floor(gaps.length / 2)));
  const diff = second - first;
  if (Math.abs(diff) < 0.05) return 'ห่างคงที่';
  return diff > 0 ? 'ห่างมากขึ้น' : 'ห่างลดลง';
}

function average(arr) {
  return arr.reduce((sum, x) => sum + x, 0) / Math.max(1, arr.length);
}

function renderAll() {
  syncControlOutputs();
  generatePoints();
  state.currentIndex = Math.min(state.currentIndex, state.points.length - 1);
  renderTape();
  renderTable();
  renderSummary();
  renderChart();
  updateAnimationFrame();
}

function renderTape() {
  const s = readSettings();
  const maxX = Math.max(...state.points.map(p => p.x), 10);
  const wrapWidth = els.tape.parentElement.clientWidth || 0;
  const width = Math.max(wrapWidth, Math.ceil(maxX * s.scale + 96));
  els.tape.style.width = `${width}px`;
  els.ruler.style.width = `${width}px`;
  els.tape.innerHTML = '';
  els.ruler.innerHTML = '';

  drawRuler(maxX, s.scale, width);

  state.points.slice(0, state.currentIndex + 1).forEach((p) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'dot';
    dot.style.left = `${40 + p.x * s.scale}px`;
    dot.title = `จุดที่ ${p.index}: t=${p.t.toFixed(3)} s, s=${p.x.toFixed(2)} cm`;
    dot.dataset.index = p.index;
    dot.addEventListener('click', () => selectDot(p.index));
    els.tape.appendChild(dot);

    if (p.index % s.groupSize === 0) {
      const label = document.createElement('div');
      label.className = 'dot-label';
      label.style.left = `${40 + p.x * s.scale}px`;
      label.textContent = p.index;
      els.tape.appendChild(label);
    }
  });

  state.groups.forEach((g) => {
    if (g.end > state.currentIndex) return;
    const x1 = 40 + state.points[g.start].x * s.scale;
    const x2 = 40 + state.points[g.end].x * s.scale;
    const bracket = document.createElement('div');
    bracket.className = 'group-bracket';
    bracket.style.left = `${x1}px`;
    bracket.style.width = `${Math.max(8, x2 - x1)}px`;
    bracket.innerHTML = `<span>ช่วง ${g.n}</span>`;
    els.tape.appendChild(bracket);
  });

  renderSelectionGuides(s);
  refreshDotSelection();
}

function renderSelectionGuides(settings) {
  els.tape.querySelectorAll('.selection-guide, .selection-ruler-tag').forEach(el => el.remove());

  state.selectedDots.forEach((index) => {
    if (index > state.currentIndex) return;
    const point = state.points[index];
    if (!point) return;

    const x = 40 + point.x * settings.scale;
    const guide = document.createElement('div');
    guide.className = 'selection-guide';
    guide.style.left = `${x}px`;
    els.tape.appendChild(guide);

    const tag = document.createElement('div');
    tag.className = 'selection-ruler-tag';
    tag.style.left = `${x}px`;
    tag.textContent = `${point.x.toFixed(1)} cm`;
    els.tape.appendChild(tag);
  });
}

function drawRuler(maxX, scale, width) {
  const maxCm = Math.ceil(maxX / 5) * 5;
  for (let mm = 0; mm <= maxCm * 10; mm++) {
    const cm = mm / 10;
    const mark = document.createElement('div');
    const isCm = mm % 10 === 0;
    const isHalfCm = mm % 5 === 0;
    mark.className = `ruler-mark ${isCm ? 'major' : isHalfCm ? 'half' : 'minor'}`;
    mark.style.left = `${40 + cm * scale}px`;
    els.ruler.appendChild(mark);

    if (isCm && Number.isInteger(cm)) {
      const label = document.createElement('div');
      label.className = 'ruler-label';
      label.style.left = `${40 + cm * scale}px`;
      label.textContent = `${cm} cm`;
      els.ruler.appendChild(label);
    }
  }
  els.ruler.style.minWidth = `${width}px`;
}

function renderTable() {
  els.dataBody.innerHTML = '';
  state.groups.forEach((g) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${g.n}</td>
      <td>${g.start} - ${g.end}</td>
      <td>${g.t1.toFixed(3)}</td>
      <td>${g.t2.toFixed(3)}</td>
      <td>${g.ds.toFixed(2)}</td>
      <td>${g.dt.toFixed(3)}</td>
      <td>${g.vAvg.toFixed(2)}</td>
      <td>${g.accApprox === null ? '-' : g.accApprox.toFixed(2)}</td>
      <td>${g.trend}</td>
    `;
    els.dataBody.appendChild(tr);
  });
}

function renderSummary() {
  const s = readSettings();
  const dt = 1 / s.freq;
  const first = state.points[0];
  const last = state.points[state.points.length - 1];
  const totalDistance = last.x - first.x;
  const totalTime = last.t - first.t;
  const avgSpeed = totalDistance / Math.max(totalTime, 0.0001);

  els.dtSummary.textContent = `${dt.toFixed(3)} s`;
  els.dotSummary.textContent = `${state.points.length} จุด`;
  els.distanceSummary.textContent = `${totalDistance.toFixed(2)} cm`;
  els.avgSpeedSummary.textContent = `${avgSpeed.toFixed(2)} cm/s`;
  els.motionStatus.textContent = statusText(s);

  let text = '';
  if (s.mode === 'custom') {
    const profile = s.customSegments
      .map((segment, index) => `ช่วง ${index + 1}: a=${segment.a.toFixed(0)} cm/s²`)
      .join(', ');
    text = `ข้อสรุป: โหมดกำหนดเองใช้ความเร่งหลายช่วงในรอบเดียว (${profile}) จึงสามารถเห็นจุดห่างเพิ่มขึ้น คงที่ หรือลดลงในแถบเดียวกันได้`;
  } else if (Math.abs(s.acc) < 0.001) {
    text = 'ข้อสรุป: ระยะห่างระหว่างจุดใกล้เคียงกัน แสดงว่าวัตถุเคลื่อนที่ด้วยความเร็วคงที่ ความเร่งประมาณศูนย์';
  } else if (s.acc > 0) {
    text = 'ข้อสรุป: จุดบนแถบกระดาษห่างมากขึ้นเรื่อย ๆ แสดงว่าวัตถุเคลื่อนที่เร็วขึ้น จึงมีความเร่งในทิศทางเดียวกับการเคลื่อนที่';
  } else {
    text = 'ข้อสรุป: จุดบนแถบกระดาษห่างลดลงเรื่อย ๆ แสดงว่าวัตถุเคลื่อนที่ช้าลง จึงเกิดความหน่วงหรือความเร่งทิศตรงข้ามกับการเคลื่อนที่';
  }
  els.interpretation.textContent = text;
}

function statusText(settings) {
  if (settings.mode === 'custom') {
    const hasPositive = settings.customSegments.some(segment => segment.a > 0);
    const hasNegative = settings.customSegments.some(segment => segment.a < 0);
    if (hasPositive && hasNegative) return 'กำหนดเอง: เร่งและหน่วง';
    if (hasPositive) return 'กำหนดเอง: เร่งขึ้น';
    if (hasNegative) return 'กำหนดเอง: หน่วงลง';
    return 'กำหนดเอง: คงที่';
  }
  if (settings.mode === 'constant' || Math.abs(settings.acc) < 0.001) return 'ความเร็วคงที่';
  if (settings.acc > 0) return 'กำลังเร่ง';
  return 'กำลังหน่วง';
}

function renderChart() {
  const ctx = els.chart.getContext('2d');
  const w = els.chart.width;
  const h = els.chart.height;
  ctx.clearRect(0, 0, w, h);

  const type = els.graphType.value;
  let values;
  let visibleValues;
  let yLabel;
  let title;

  if (type === 'velocity') {
    values = state.points.map(p => ({ t: p.t, y: p.v }));
    yLabel = 'v (cm/s)';
    title = 'กราฟความเร็ว - เวลา';
  } else if (type === 'acceleration') {
    values = state.points.map(p => ({ t: p.t, y: p.a }));
    yLabel = 'a (cm/s²)';
    title = 'กราฟความเร่ง - เวลา';
  } else {
    values = state.points.map(p => ({ t: p.t, y: p.x }));
    yLabel = 's (cm)';
    title = 'กราฟตำแหน่ง - เวลา';
  }

  visibleValues = values.slice(0, Math.max(1, state.currentIndex + 1));
  drawAxisChart(ctx, visibleValues, title, 't (s)', yLabel, w, h, values);
}

function drawAxisChart(ctx, values, title, xLabel, yLabel, w, h, domainValues = values) {
  const pad = { left: 78, right: 26, top: 48, bottom: 58 };
  const xMin = 0;
  const xMax = Math.max(...domainValues.map(v => v.t), 1);
  let yMin = Math.min(...domainValues.map(v => v.y));
  let yMax = Math.max(...domainValues.map(v => v.y));

  if (Math.abs(yMax - yMin) < 0.001) {
    yMax += Math.max(1, Math.abs(yMax) * 0.2);
    yMin -= Math.max(1, Math.abs(yMin) * 0.2);
  }

  const yPad = (yMax - yMin) * 0.12;
  yMax += yPad;
  yMin -= yPad;

  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const xToPx = (x) => pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
  const yToPx = (y) => pad.top + (1 - ((y - yMin) / (yMax - yMin))) * plotH;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#d8e3f4';
  ctx.lineWidth = 1;
  ctx.font = `18px ${chartMathFont}`;
  ctx.fillStyle = '#60718a';

  for (let i = 0; i <= 5; i++) {
    const x = pad.left + (plotW / 5) * i;
    const t = xMin + ((xMax - xMin) / 5) * i;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotH);
    ctx.stroke();
    ctx.fillText(t.toFixed(1), x - 10, pad.top + plotH + 28);
  }

  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (plotH / 5) * i;
    const val = yMax - ((yMax - yMin) / 5) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillText(val.toFixed(1), 14, y + 6);
  }

  ctx.strokeStyle = '#10243f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();

  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 4;
  ctx.beginPath();
  values.forEach((point, i) => {
    const x = xToPx(point.t);
    const y = yToPx(point.y);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#2563eb';
  const step = Math.max(1, Math.floor(values.length / 18));
  values.forEach((point, i) => {
    if (i % step !== 0 && i !== values.length - 1) return;
    ctx.beginPath();
    ctx.arc(xToPx(point.t), yToPx(point.y), 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = '#10243f';
  ctx.font = `bold 22px ${chartFont}`;
  ctx.fillText(title, pad.left, 30);
  ctx.font = `18px ${chartMathFont}`;
  ctx.fillText(xLabel, w / 2 - 18, h - 15);
  ctx.save();
  ctx.translate(22, h / 2 + 35);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

function runSimulation() {
  clearInterval(state.timer);
  state.running = true;
  els.needle.classList.add('active');
  renderTape();
  const s = readSettings();
  const tickMs = Math.max(10, (1 / s.freq) * 1000);
  state.timer = setInterval(() => {
    if (state.currentIndex >= state.points.length - 1) {
      pauseSimulation();
      return;
    }
    state.currentIndex += 1;
    renderTape();
    renderChart();
    updateAnimationFrame();
  }, tickMs);
}

function pauseSimulation() {
  state.running = false;
  els.needle.classList.remove('active');
  clearInterval(state.timer);
}

function stepSimulation() {
  pauseSimulation();
  if (state.currentIndex < state.points.length - 1) {
    state.currentIndex += 1;
  } else {
    state.currentIndex = 0;
  }
  renderTape();
  renderChart();
  updateAnimationFrame();
}

function updateAnimationFrame() {
  const s = readSettings();
  const point = state.points[state.currentIndex] || state.points[0];
  const sceneWidth = els.cart.parentElement.clientWidth || 900;
  const machineOffset = Math.min(230, sceneWidth * 0.28);
  const cartWidth = els.cart.offsetWidth || 128;
  const travelLimit = Math.max(0, sceneWidth - machineOffset - cartWidth - 24);
  const maxX = Math.max(...state.points.map(p => p.x), 1);
  const px = Math.min((point.x / maxX) * travelLimit, travelLimit);
  els.cart.style.transform = `translateX(${px}px)`;
  scrollTapeToCurrentDot(point, s);
  document.querySelectorAll('.dot').forEach((dot) => {
    dot.classList.toggle('current', Number(dot.dataset.index) === state.currentIndex);
  });
}

function scrollTapeToCurrentDot(point, settings) {
  if (!state.running) return;
  const wrap = els.tape.parentElement;
  const x = 40 + point.x * settings.scale;
  const target = Math.max(0, x - wrap.clientWidth * 0.72);
  wrap.scrollTo({ left: target, behavior: 'smooth' });
}

function selectDot(index) {
  if (state.selectedDots.includes(index)) {
    state.selectedDots = state.selectedDots.filter(x => x !== index);
  } else {
    if (state.selectedDots.length >= 2) state.selectedDots.shift();
    state.selectedDots.push(index);
  }
  renderTape();
  updateMeasureResult();
}

function refreshDotSelection() {
  document.querySelectorAll('.dot').forEach((dot) => {
    const idx = Number(dot.dataset.index);
    dot.classList.toggle('selected', state.selectedDots.includes(idx));
    dot.classList.toggle('current', idx === state.currentIndex);
  });
}

function updateMeasureResult() {
  if (state.selectedDots.length < 2) {
    els.measureResult.textContent = state.selectedDots.length === 1
      ? `เลือกจุดที่ ${state.selectedDots[0]} แล้ว เลือกอีก 1 จุด`
      : 'ยังไม่ได้เลือกจุด';
    return;
  }
  const [a, b] = [...state.selectedDots].sort((x, y) => x - y);
  const p1 = state.points[a];
  const p2 = state.points[b];
  const ds = Math.abs(p2.x - p1.x);
  const dt = Math.abs(p2.t - p1.t);
  const v = ds / Math.max(dt, 0.0001);
  els.measureResult.innerHTML = `จุด ${a} → ${b}<br>Δs = ${ds.toFixed(2)} cm<br>Δt = ${dt.toFixed(3)} s<br>v̄ = ${v.toFixed(2)} cm/s`;
}

function clearMeasurement() {
  state.selectedDots = [];
  renderTape();
  updateMeasureResult();
}

function downloadCsv() {
  const headers = ['ช่วง', 'จุดเริ่ม', 'จุดจบ', 'เวลาเริ่ม(s)', 'เวลาจบ(s)', 'ระยะในช่วง(cm)', 'Δt(s)', 'vเฉลี่ย(cm/s)', 'aโดยประมาณ(cm/s^2)', 'ลักษณะจุด'];
  const rows = state.groups.map(g => [
    g.n,
    g.start,
    g.end,
    g.t1.toFixed(3),
    g.t2.toFixed(3),
    g.ds.toFixed(2),
    g.dt.toFixed(3),
    g.vAvg.toFixed(2),
    g.accApprox === null ? '' : g.accApprox.toFixed(2),
    g.trend
  ]);
  const csv = [headers, ...rows].map(row => row.map(csvSafe).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ticker-timer-data.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function csvSafe(value) {
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function getAnswerMotionType(settings) {
  if (settings.mode === 'custom') {
    const hasPositive = settings.customSegments.some(segment => segment.a > 0);
    const hasNegative = settings.customSegments.some(segment => segment.a < 0);
    if (hasPositive && hasNegative) return 'mixed';
    if (hasPositive) return 'accelerate';
    if (hasNegative) return 'decelerate';
    return 'constant';
  }
  return Math.abs(settings.acc) < 0.001 ? 'constant' : (settings.acc > 0 ? 'accelerate' : 'decelerate');
}

function answerTypeLabel(type) {
  if (type === 'mixed') return 'มีทั้งเร่งขึ้นและลดลง';
  if (type === 'constant') return 'ความเร็วคงที่';
  if (type === 'accelerate') return 'มีความเร่ง / เร็วขึ้น';
  return 'มีความหน่วง / ช้าลง';
}

function checkAnswers() {
  const s = readSettings();
  const last = state.points[state.points.length - 1];
  const dtAnswer = Number(els.ansDt.value);
  const distAnswer = Number(els.ansDistance.value);
  const typeAnswer = els.ansType.value;
  const trueDt = 1 / s.freq;
  const trueDistance = last.x - state.points[0].x;
  const trueType = getAnswerMotionType(s);

  let score = 0;
  const notes = [];

  if (Math.abs(dtAnswer - trueDt) <= 0.002) score += 1;
  else notes.push(`ข้อ 1 คำตอบที่ถูกคือประมาณ ${trueDt.toFixed(3)} s`);

  if (Math.abs(distAnswer - trueDistance) <= Math.max(0.2, trueDistance * 0.03)) score += 1;
  else notes.push(`ข้อ 2 คำตอบที่ถูกคือประมาณ ${trueDistance.toFixed(2)} cm`);

  if (typeAnswer === trueType) score += 1;
  else notes.push(`ข้อ 3 คำตอบที่ถูกคือ “${answerTypeLabel(trueType)}”`);

  els.answerFeedback.className = `feedback ${score === 3 ? 'good' : 'bad'}`;
  els.answerFeedback.innerHTML = score === 3
    ? 'ยอดเยี่ยม! ถูกครบ 3 ข้อ'
    : `ได้ ${score}/3 คะแนน<br>${notes.join('<br>')}`;
}

function resetDefaults() {
  pauseSimulation();
  els.motionMode.value = 'accelerate';
  els.v0.value = 25;
  els.acc.value = 35;
  els.freq.value = 50;
  els.duration.value = 2.0;
  els.groupSize.value = 5;
  els.scale.value = 60;
  els.customT1.value = 0.6;
  els.customT2.value = 1.1;
  els.customT3.value = 1.6;
  els.customA1.value = 60;
  els.customA2.value = 0;
  els.customA3.value = -80;
  els.customA4.value = 30;
  state.currentIndex = 0;
  state.selectedDots = [];
  els.ansDt.value = '';
  els.ansDistance.value = '';
  els.ansType.value = '';
  els.answerFeedback.className = 'feedback';
  els.answerFeedback.textContent = 'กรอกคำตอบแล้วกด “ตรวจคำตอบ”';
  renderAll();
}

function handleControlChange() {
  pauseSimulation();
  state.currentIndex = 0;
  state.selectedDots = [];
  renderAll();
}

let resizeTimer = null;
function handleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderTape();
    updateAnimationFrame();
  }, 120);
}

function togglePanel() {
  state.panelHidden = !state.panelHidden;
  document.body.classList.toggle('panel-hidden', state.panelHidden);
  els.togglePanelBtn.textContent = state.panelHidden ? 'แสดงแผง' : 'ซ่อนแผง';
  els.togglePanelBtn.setAttribute('aria-pressed', String(state.panelHidden));
  handleResize();
}

function toggleValues() {
  state.valuesHidden = !state.valuesHidden;
  document.body.classList.toggle('values-hidden', state.valuesHidden);
  els.toggleValuesBtn.textContent = state.valuesHidden ? 'แสดงค่า' : 'ซ่อนค่า';
  els.toggleValuesBtn.setAttribute('aria-pressed', String(state.valuesHidden));
}

function togglePeriod() {
  state.periodHidden = !state.periodHidden;
  document.body.classList.toggle('period-hidden', state.periodHidden);
  els.togglePeriodBtn.textContent = state.periodHidden ? 'แสดงช่วง' : 'ซ่อนช่วง';
  els.togglePeriodBtn.setAttribute('aria-pressed', String(state.periodHidden));
}

['input', 'change'].forEach(evt => {
  [
    els.v0,
    els.acc,
    els.freq,
    els.duration,
    els.groupSize,
    els.scale,
    els.motionMode,
    els.customT1,
    els.customT2,
    els.customT3,
    els.customA1,
    els.customA2,
    els.customA3,
    els.customA4
  ].forEach(el => {
    el.addEventListener(evt, handleControlChange);
  });
});

els.graphType.addEventListener('change', renderChart);
function startFromControls() {
  if (state.currentIndex >= state.points.length - 1) state.currentIndex = 0;
  renderChart();
  runSimulation();
}

els.runBtn.addEventListener('click', startFromControls);
els.pauseBtn.addEventListener('click', pauseSimulation);
els.stepBtn.addEventListener('click', stepSimulation);
els.simRunBtn.addEventListener('click', startFromControls);
els.simPauseBtn.addEventListener('click', pauseSimulation);
els.simStepBtn.addEventListener('click', stepSimulation);
els.resetBtn.addEventListener('click', resetDefaults);
els.togglePanelBtn.addEventListener('click', togglePanel);
els.toggleValuesBtn.addEventListener('click', toggleValues);
els.togglePeriodBtn.addEventListener('click', togglePeriod);
els.clearMeasureBtn.addEventListener('click', clearMeasurement);
els.downloadCsvBtn.addEventListener('click', downloadCsv);
els.checkAnswersBtn.addEventListener('click', checkAnswers);
window.addEventListener('resize', handleResize);

renderAll();
