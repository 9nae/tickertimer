const FREQUENCY = 50;
const PERIOD = 1 / FREQUENCY;
const MAX_MANUAL_PERIODS = 250;
const MIN_TAPE_SCALE = 32;
const FIT_TO_VIEW_DOMAIN = 20;

const els = {
  labStage: document.getElementById('labStage'),
  cart: document.getElementById('cart'),
  striker: document.getElementById('striker'),
  paperTail: document.getElementById('paperTail'),
  motionStatus: document.getElementById('motionStatus'),
  playBtn: document.getElementById('playBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  stepBtn: document.getElementById('stepBtn'),
  resetBtn: document.getElementById('resetBtn'),
  tapeViewport: document.getElementById('tapeViewport'),
  tapeSheet: document.getElementById('tapeSheet'),
  tapeRuler: document.getElementById('tapeRuler'),
  tape: document.getElementById('tape'),
  fullTapeViewport: document.getElementById('fullTapeViewport'),
  fullTapeSheet: document.getElementById('fullTapeSheet'),
  fullTapeRuler: document.getElementById('fullTapeRuler'),
  fullTape: document.getElementById('fullTape'),
  selectionSummary: document.getElementById('selectionSummary'),
  clearSelectionBtn: document.getElementById('clearSelectionBtn'),
  solutionPanel: document.getElementById('solutionPanel'),
  solutionContent: document.getElementById('solutionContent'),
  selectedPeriodBadge: document.getElementById('selectedPeriodBadge'),
  startReference: document.getElementById('startReference'),
  endReference: document.getElementById('endReference'),
  solutionTabs: [...document.querySelectorAll('.solution-tab')],
  graphDialog: document.getElementById('graphDialog'),
  graphType: document.getElementById('graphType'),
  chart: document.getElementById('chart'),
  toggleGraphBtn: document.getElementById('toggleGraphBtn'),
  closeGraphBtn: document.getElementById('closeGraphBtn'),
  toggleSolutionBtn: document.getElementById('toggleSolutionBtn'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  settingsDialog: document.getElementById('settingsDialog'),
  motionMode: document.getElementById('motionMode'),
  v0: document.getElementById('v0'),
  v0Out: document.getElementById('v0Out'),
  acc: document.getElementById('acc'),
  accOut: document.getElementById('accOut'),
  duration: document.getElementById('duration'),
  playbackRate: document.getElementById('playbackRate'),
  applySettingsBtn: document.getElementById('applySettingsBtn'),
  openPaperBtn: document.getElementById('openPaperBtn'),
  paperDialog: document.getElementById('paperDialog'),
  closePaperBtn: document.getElementById('closePaperBtn'),
  paperDialogSummary: document.getElementById('paperDialogSummary')
};

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

const state = {
  points: [],
  currentIndex: 0,
  selectedDots: [],
  running: false,
  runTimer: null,
  source: 'auto',
  solutionType: 'instantaneous',
  solutionVisible: true,
  dragging: false,
  dragX: 0,
  dragPointerOffset: 0,
  manualTimer: null,
  hoveredDot: null,
  graphPointerIndex: null
};

let graphResizeFrame = 0;
let graphGeometry = null;
const graphResizeObserver = typeof ResizeObserver === 'function'
  ? new ResizeObserver(() => {
      if (!els.graphDialog.open) return;
      window.cancelAnimationFrame(graphResizeFrame);
      graphResizeFrame = window.requestAnimationFrame(drawGraph);
    })
  : null;
graphResizeObserver?.observe(els.chart.parentElement);

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function formatNumber(value, digits = 2) {
  const clean = Math.abs(value) < 1e-9 ? 0 : value;
  return clean.toFixed(digits);
}

function cssToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function readSettings() {
  const mode = els.motionMode.value;
  const v0 = clamp(els.v0.value, 0, 120);
  const magnitude = clamp(els.acc.value, 0, 120);
  const duration = clamp(els.duration.value, 0.4, 5);
  const totalPeriods = Math.round(duration * FREQUENCY);
  const playbackRate = clamp(els.playbackRate.value, 0.5, 2);
  const acceleration = mode === 'constant' ? 0 : mode === 'decelerate' ? -magnitude : magnitude;
  return { mode, v0, magnitude, acceleration, duration, totalPeriods, playbackRate };
}

function syncSettingsUi() {
  const settings = readSettings();
  els.v0Out.textContent = `${formatNumber(settings.v0, 0)} cm/s`;
  els.accOut.textContent = `${formatNumber(settings.magnitude, 0)} cm/s²`;
  els.acc.disabled = settings.mode === 'constant';
  const helper = els.duration.closest('.field')?.querySelector('small');
  if (helper) {
    helper.textContent = `${formatNumber(settings.duration, 3)} s · ได้ ${settings.totalPeriods + 1} จุด · ห่างจุดละ 1/50 s`;
  }
}

function generateAutoPoints() {
  const settings = readSettings();
  const points = [];
  const stopTime = settings.acceleration < 0 && settings.v0 > 0
    ? settings.v0 / Math.abs(settings.acceleration)
    : 0;

  for (let index = 0; index <= settings.totalPeriods; index += 1) {
    const t = index * PERIOD;
    let x = settings.v0 * t + 0.5 * settings.acceleration * t * t;
    let v = settings.v0 + settings.acceleration * t;
    let a = settings.acceleration;

    if (settings.mode === 'decelerate' && t >= stopTime) {
      x = settings.v0 * stopTime + 0.5 * settings.acceleration * stopTime * stopTime;
      v = 0;
      a = 0;
    }

    points.push({ index, t, x: Math.max(0, x), v: Math.max(0, v), a });
  }

  return points;
}

function regenerateSimulation() {
  pauseSimulation();
  state.source = 'auto';
  state.points = generateAutoPoints();
  state.currentIndex = 0;
  state.selectedDots = [];
  syncSettingsUi();
  renderStatic();
  renderFrame();
}

function renderStatic() {
  renderTape(els.tape, false);
  renderTape(els.fullTape, true);
  renderSelectionSummary();
  syncReferencePickers();
  renderSolution();
  drawGraph();
}

function currentPoint() {
  return state.points[state.currentIndex] || { index: 0, t: 0, x: 0, v: 0, a: 0 };
}

function maximumPosition() {
  const values = state.points.map(point => point.x);
  return Math.max(1, ...values);
}

function renderFrame() {
  renderStage();
  renderReadouts();
  refreshDotStates();
  updateTransportState();
  drawGraph();
}

function renderStage() {
  const point = currentPoint();
  const stageWidth = els.labStage.clientWidth || 720;
  const cartWidth = els.cart.offsetWidth || 160;
  const base = stageWidth >= 640 ? 112 : 83;
  const available = Math.max(20, stageWidth - base - cartWidth - 24);
  const domain = state.source === 'manual' ? 120 : maximumPosition();
  const ratio = clamp(point.x / Math.max(1, domain), 0, 1);
  const translation = ratio * available;
  els.cart.style.setProperty('--cart-x', `${translation}px`);
  els.paperTail.style.transform = `scaleX(${clamp(0.08 + ratio * 0.92, 0.08, 1)})`;
}

function renderReadouts() {
  const point = currentPoint();
  els.motionStatus.className = 'status';
  if (state.dragging) {
    els.motionStatus.classList.add('is-manual');
    els.motionStatus.textContent = 'กำลังบันทึกจากการลาก';
  } else if (state.running) {
    els.motionStatus.classList.add('is-running');
    els.motionStatus.textContent = 'กำลังเคาะจุด';
  } else if (state.source === 'manual') {
    els.motionStatus.classList.add('is-manual');
    els.motionStatus.textContent = 'บันทึกจากการลากแล้ว';
  } else {
    els.motionStatus.textContent = point.index === 0 ? 'พร้อมทดลอง' : 'หยุดชั่วคราว';
  }
}

function tapeLayout(container, fullPaper) {
  const viewport = fullPaper ? els.fullTapeViewport : els.tapeViewport;
  const parentWidth = viewport.clientWidth || 760;
  const maxX = maximumPosition();
  const domain = Math.max(1, Math.ceil(maxX));
  const inset = 48;
  const fitScale = Math.max(1, (parentWidth - 2 - inset * 2) / domain);
  const shouldFitMainTape = !fullPaper && domain <= FIT_TO_VIEW_DOMAIN;
  const scale = shouldFitMainTape ? fitScale : Math.max(MIN_TAPE_SCALE, fitScale);
  const width = Math.max(parentWidth - 2, domain * scale + inset * 2);
  const usable = Math.max(1, width - inset * 2);
  return {
    width,
    domain,
    scale,
    left(point) {
      return inset + (point.x / domain) * usable;
    }
  };
}

function renderTape(container, fullPaper) {
  if (!state.points.length) {
    container.replaceChildren();
    return;
  }

  const layout = tapeLayout(container, fullPaper);
  const sheet = fullPaper ? els.fullTapeSheet : els.tapeSheet;
  const ruler = fullPaper ? els.fullTapeRuler : els.tapeRuler;
  sheet.style.width = `${layout.width}px`;
  container.style.width = `${layout.width}px`;
  const fragment = document.createDocumentFragment();

  state.points.forEach(point => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'tape-dot';
    dot.dataset.index = String(point.index);
    dot.style.left = `${layout.left(point)}px`;
    dot.setAttribute('aria-label', `จุดที่ ${point.index} บนแถบกระดาษ`);
    dot.tabIndex = -1;

    const referenceLabelElement = document.createElement('span');
    referenceLabelElement.className = 'ref-label';
    referenceLabelElement.setAttribute('aria-hidden', 'true');

    const distanceLabelElement = document.createElement('span');
    distanceLabelElement.className = 'distance-label';
    distanceLabelElement.setAttribute('aria-hidden', 'true');
    dot.append(referenceLabelElement, distanceLabelElement);
    fragment.append(dot);
  });

  container.replaceChildren(fragment);
  renderRuler(ruler, layout);
  refreshDotStates();
}

function rulerTickStepMillimetres(scale) {
  const pxPerMillimetre = scale / 10;
  if (pxPerMillimetre >= 1.6) return 1;
  if (pxPerMillimetre >= 0.8) return 5;
  return 10;
}

function renderRuler(ruler, layout) {
  const fragment = document.createDocumentFragment();

  const unit = document.createElement('span');
  unit.className = 'ruler-unit';
  unit.textContent = 'cm';
  fragment.append(unit);

  const totalMillimetres = Math.ceil(layout.domain * 10);
  const tickStep = rulerTickStepMillimetres(layout.scale);
  for (let mm = 0; mm <= totalMillimetres; mm += tickStep) {
    const cm = mm / 10;
    const tick = document.createElement('span');
    const tickType = mm % 10 === 0 ? 'major' : mm % 5 === 0 ? 'mid' : 'minor';
    tick.className = `ruler-tick ${tickType}`;
    tick.style.left = `${layout.left({ x: cm })}px`;
    tick.innerHTML = mm > 0 && mm % 10 === 0 ? `<i></i><b>${cm}</b>` : '<i></i>';
    fragment.append(tick);
  }

  ruler.replaceChildren(fragment);
}

function refreshDotStates() {
  [els.tape, els.fullTape].forEach(container => {
    container.querySelectorAll('.tape-dot').forEach(dot => {
      const index = Number(dot.dataset.index);
      const point = state.points[index];
      const distanceText = pointPositionText(point);
      const referenceIndex = state.selectedDots.indexOf(index);
      dot.classList.toggle('is-current', index === state.currentIndex);
      dot.classList.toggle('is-future', state.source === 'auto' && index > state.currentIndex);
      dot.classList.toggle('is-selected', referenceIndex >= 0);
      dot.classList.toggle('is-hovered', index === state.hoveredDot);
      const label = referenceIndex >= 0 ? referenceLabel(referenceIndex) : '';
      dot.dataset.refLabel = label;
      dot.dataset.distance = distanceText;
      const labelElement = dot.querySelector('.ref-label');
      if (labelElement) labelElement.textContent = label;
      const distanceLabelElement = dot.querySelector('.distance-label');
      if (distanceLabelElement) distanceLabelElement.textContent = distanceText;
      dot.setAttribute('aria-pressed', String(state.selectedDots.includes(index)));
      dot.setAttribute('aria-label', `จุดที่ ${index} ระยะ ${distanceText} บนแถบกระดาษ`);
    });
  });
}

function pointPositionText(point) {
  return `${formatNumber(point?.x ?? 0)} cm`;
}

function visibleTapePoints() {
  return state.source === 'auto'
    ? state.points.slice(0, state.currentIndex + 1)
    : state.points;
}

function nearestTapePointIndex(container, fullPaper, event) {
  if (!state.points.length) return null;

  const points = visibleTapePoints();
  if (!points.length) return null;

  const layout = tapeLayout(container, fullPaper);
  const rect = container.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  let nearest = points[0];
  let nearestDistance = Math.abs(layout.left(nearest) - pointerX);

  points.forEach(point => {
    const distance = Math.abs(layout.left(point) - pointerX);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  });

  return nearest.index;
}

function setHoveredDot(index) {
  const nextIndex = Number.isInteger(index) ? index : null;
  if (state.hoveredDot === nextIndex) return;
  state.hoveredDot = nextIndex;
  refreshDotStates();
}

function handleTapePointerMove(event) {
  const container = event.currentTarget;
  const fullPaper = container === els.fullTape;
  setHoveredDot(nearestTapePointIndex(container, fullPaper, event));
}

function handleTapePointerLeave() {
  setHoveredDot(null);
}

function handleTapeClick(event) {
  const container = event.currentTarget;
  const fullPaper = container === els.fullTape;
  const pointIndex = nearestTapePointIndex(container, fullPaper, event);
  if (Number.isInteger(pointIndex)) selectDot(pointIndex);
}

function referenceLabel(index) {
  return String.fromCharCode(65 + index);
}

function referenceName(pointIndex) {
  const index = state.selectedDots.indexOf(pointIndex);
  return index >= 0 ? referenceLabel(index) : `จุด ${pointIndex}`;
}

function selectDot(index) {
  if (state.selectedDots.includes(index)) {
    state.selectedDots = state.selectedDots.filter(value => value !== index);
  } else if (state.selectedDots.length < 26) {
    state.selectedDots.push(index);
  }
  state.selectedDots.sort((a, b) => a - b);
  refreshDotStates();
  renderSelectionSummary();
  syncReferencePickers();
  renderSolution();
  drawGraph();
}

function clearSelection() {
  state.selectedDots = [];
  refreshDotStates();
  renderSelectionSummary();
  syncReferencePickers();
  renderSolution();
  drawGraph();
}

function renderSelectionSummary() {
  if (!state.selectedDots.length) {
    els.selectionSummary.textContent = 'เลือกจุดอ้างอิงบนแถบได้หลายจุด ระบบจะกำกับ A, B, C… จากซ้ายไปขวา';
    return;
  }

  if (state.selectedDots.length === 1) {
    const pointIndex = state.selectedDots[0];
    els.selectionSummary.textContent = `A = จุด ${pointIndex} · ${pointPositionText(state.points[pointIndex])} · คำนวณอัตราเร็ว ณ จุดได้แล้ว`;
    return;
  }

  els.selectionSummary.textContent = state.selectedDots
    .map((pointIndex, referenceIndex) => `${referenceLabel(referenceIndex)} = จุด ${pointIndex} · ${pointPositionText(state.points[pointIndex])}`)
    .join(' · ');
}

function syncReferencePickers() {
  const previousStart = Number(els.startReference.value);
  const previousEnd = Number(els.endReference.value);
  const options = state.selectedDots.map((pointIndex, referenceIndex) =>
    `<option value="${pointIndex}">${referenceLabel(referenceIndex)} · จุด ${pointIndex} · ${pointPositionText(state.points[pointIndex])}</option>`
  ).join('');
  const ready = state.selectedDots.length >= 1;
  els.startReference.innerHTML = ready ? options : '<option value="">เลือกจุด</option>';
  els.endReference.innerHTML = ready ? options : '<option value="">เลือกจุด</option>';
  els.startReference.disabled = !ready;
  els.endReference.disabled = !ready;
  if (!ready) return;
  els.startReference.value = state.selectedDots.includes(previousStart) ? String(previousStart) : String(state.selectedDots[0]);
  els.endReference.value = state.selectedDots.includes(previousEnd) ? String(previousEnd) : String(state.selectedDots[state.selectedDots.length - 1]);
  if (els.startReference.value === els.endReference.value && state.selectedDots.length >= 2) {
    const first = String(state.selectedDots[0]);
    const last = String(state.selectedDots[state.selectedDots.length - 1]);
    els.endReference.value = els.startReference.value === last ? first : last;
  }
}

function selectionData() {
  if (state.selectedDots.length < 2) return null;
  let startIndex = Number(els.startReference.value);
  let endIndex = Number(els.endReference.value);
  if (!state.selectedDots.includes(startIndex)) startIndex = state.selectedDots[0];
  if (!state.selectedDots.includes(endIndex)) endIndex = state.selectedDots[state.selectedDots.length - 1];
  if (startIndex > endIndex) [startIndex, endIndex] = [endIndex, startIndex];
  const start = state.points[startIndex];
  const end = state.points[endIndex];
  if (!start || !end || endIndex <= startIndex) return null;

  let distance = 0;
  for (let index = startIndex + 1; index <= endIndex; index += 1) {
    distance += Math.abs(state.points[index].x - state.points[index - 1].x);
  }

  const periods = endIndex - startIndex;
  const dt = periods * PERIOD;
  const displacement = end.x - start.x;
  return {
    start,
    end,
    periods,
    dt,
    distance,
    displacement,
    avgSpeed: distance / dt,
    avgVelocity: displacement / dt,
    avgAcceleration: (end.v - start.v) / dt
  };
}

function fraction(numerator, denominator) {
  return `<span class="fraction"><span>${numerator}</span><span>${denominator}</span></span>`;
}

function localVelocity(index) {
  const lastIndex = state.points.length - 1;
  const beforeIndex = index <= 0 ? 0 : index - 1;
  const afterIndex = index >= lastIndex ? lastIndex : index + 1;
  const before = state.points[beforeIndex];
  const after = state.points[afterIndex];
  const intervals = Math.max(1, afterIndex - beforeIndex);
  const dt = intervals / FREQUENCY;
  return {
    index,
    beforeIndex,
    afterIndex,
    before,
    after,
    intervals,
    dt,
    value: (after.x - before.x) / dt
  };
}

function uniquePointIndices(indices) {
  return [...new Set(indices.filter(index => Number.isInteger(index) && state.points[index]))].sort((a, b) => a - b);
}

function solutionPointRows(data, extraIndices = []) {
  const selectedInRange = state.selectedDots.filter(index => index >= data.start.index && index <= data.end.index);
  const indices = uniquePointIndices([
    data.start.index,
    data.end.index,
    ...selectedInRange,
    ...extraIndices
  ]);

  return indices.map((index, rowIndex) => {
    const point = state.points[index];
    const previous = rowIndex > 0 ? state.points[indices[rowIndex - 1]] : null;
    const deltaS = previous ? point.x - previous.x : 0;
    return {
      index,
      point,
      label: referenceName(index),
      t: point.t ?? index / FREQUENCY,
      segmentDistance: Math.abs(deltaS)
    };
  });
}

function solutionReadingMarkup(data, extraIndices = []) {
  const graphRows = solutionPointRows(data);
  const rows = solutionPointRows(data, extraIndices);
  if (graphRows.length < 2) return '';

  const positions = graphRows.map(row => row.point.x);
  const minS = Math.min(...positions);
  const maxS = Math.max(...positions);
  const spanS = Math.max(0.001, maxS - minS);
  const ratioFor = value => (value - minS) / spanS;
  const markers = graphRows.map((row, index) => `
    <span class="solution-graph-marker" style="--marker-ratio: ${ratioFor(row.point.x)}; --marker-row: ${index % 3}">
      <i></i>
      <b>${row.label}</b>
      <small>${pointPositionText(row.point)}</small>
    </span>
  `).join('');
  const segments = graphRows.slice(1).map((row, index) => {
    const previous = graphRows[index];
    const start = ratioFor(previous.point.x);
    const end = ratioFor(row.point.x);
    const left = Math.min(start, end);
    const rawWidth = Math.abs(end - start);
    const width = Math.max(0.008, rawWidth);
    const compactClass = rawWidth < 0.08 ? ' is-compact' : '';
    return `
      <span class="solution-graph-segment${compactClass}" style="--segment-left: ${left}; --segment-width: ${width}">
        <b>${formatNumber(row.segmentDistance)} cm</b>
      </span>
    `;
  }).join('');
  const tableRows = rows.map((row, index) => `
    <div class="point-row" role="row">
      <span role="cell">${row.label}</span>
      <span role="cell">จุด ${row.index}</span>
      <span role="cell">${formatNumber(row.t, 3)} s</span>
      <span role="cell">${pointPositionText(row.point)}</span>
      <span role="cell">${index === 0 ? 'เริ่ม' : `${formatNumber(row.segmentDistance)} cm`}</span>
    </div>
  `).join('');

  return `
    <section class="solution-reading" aria-label="อ่านค่าระยะจากจุดบนแถบ">
      <div class="solution-reading-head">
        <span>อ่านค่าจากจุดปะ</span>
        <strong>เทียบตำแหน่ง S บนไม้บรรทัด</strong>
      </div>
      <div class="solution-mini-graph" role="img" aria-label="กราฟย่อยแสดงระยะของแต่ละจุด">
        <div class="solution-graph-axis"></div>
        ${segments}
        ${markers}
      </div>
      <div class="solution-point-table" role="table" aria-label="ตารางเวลาและระยะของจุดที่ใช้คำนวณ">
        <div class="point-row point-row-head" role="row">
          <span role="columnheader">จุด</span>
          <span role="columnheader">ลำดับ</span>
          <span role="columnheader">t</span>
          <span role="columnheader">S</span>
          <span role="columnheader">ระยะช่วง</span>
        </div>
        ${tableRows}
      </div>
    </section>
  `;
}

function workedSolutionMarkup(title, bullets, equations, answer, note = '', reading = '') {
  return `
    <article class="worked-solution">
      <h3>${title}</h3>
      <p class="from-figure">จากรูป:</p>
      <ul class="given-list">${bullets.map(item => `<li>${item}</li>`).join('')}</ul>
      ${reading}
      <div class="equation-work">${equations.map(line => `<div class="equation-line">${line}</div>`).join('')}</div>
      <p class="final-answer">ดังนั้น <strong>${answer}</strong></p>
      ${note ? `<p class="solution-note">${note}</p>` : ''}
    </article>`;
}

function renderInstantaneousSolution(targetIndex) {
  const target = state.points[targetIndex];
  if (!target) return false;

  const targetName = referenceName(targetIndex);
  const local = localVelocity(targetIndex);
  const deltaX = local.after.x - local.before.x;
  const readingData = {
    start: local.before,
    end: local.after,
    periods: local.intervals,
    dt: local.dt
  };
  const beforeLabel = local.beforeIndex === targetIndex ? `จุด ${targetName}` : `จุดก่อน ${targetName}`;
  const afterLabel = local.afterIndex === targetIndex ? `จุด ${targetName}` : `จุดหลัง ${targetName}`;
  const bullets = [
    `จุด ${targetName} (จุด ${targetIndex}) อยู่ที่ ${formatNumber(target.x)} cm`,
    `${beforeLabel} (จุด ${local.beforeIndex}) อยู่ที่ ${formatNumber(local.before.x)} cm`,
    `${afterLabel} (จุด ${local.afterIndex}) อยู่ที่ ${formatNumber(local.after.x)} cm`,
    `เครื่องเคาะ 50 ครั้ง/วินาที → เวลาระหว่างจุด = ${fraction('1', '50')} s`,
    `เวลาจากจุด ${local.beforeIndex} ถึง ${local.afterIndex} = ${fraction(local.intervals, '50')} s`
  ];
  const equations = [
    `v<sub>${targetName}</sub> = ${fraction('S<sub>หลัง</sub> − S<sub>ก่อน</sub>', `${local.intervals}/50`)}`,
    `= ${fraction(`${formatNumber(local.after.x)} − ${formatNumber(local.before.x)}`, `${local.intervals}/50`)}`,
    `= ${fraction(formatNumber(deltaX), formatNumber(local.dt, 3))}`,
    `= ${formatNumber(local.value)} cm/s`
  ];

  els.selectedPeriodBadge.textContent = `Δt = ${local.intervals}/50 s`;
  els.solutionContent.innerHTML = workedSolutionMarkup(
    `ข้อ: หาอัตราเร็วที่จุด ${targetName}`,
    bullets,
    equations,
    `อัตราเร็วที่จุด ${targetName} = ${formatNumber(Math.abs(local.value))} cm/s`,
    `ใช้จุดก่อนและจุดหลังประกบจุด ${targetName} เพื่อประมาณอัตราเร็ว ณ ขณะนั้น ถ้าอยู่ปลายแถบ ระบบจะใช้ช่วงข้างเดียว`,
    solutionReadingMarkup(readingData, [local.beforeIndex, local.index, local.afterIndex])
  );
  return true;
}

function renderSolution() {
  const data = selectionData();
  if (state.solutionType === 'instantaneous') {
    const selectedEnd = Number(els.endReference.value);
    const targetIndex = data?.end.index ?? (state.selectedDots.includes(selectedEnd) ? selectedEnd : state.selectedDots[0]);
    if (Number.isInteger(targetIndex) && renderInstantaneousSolution(targetIndex)) return;
  }

  if (!data) {
    els.selectedPeriodBadge.textContent = 'Δt = — s';
    const message = state.selectedDots.length === 1
      ? '<strong>เลือกเพิ่มอีก 1 จุดสำหรับค่าเฉลี่ย</strong><p>ถ้าต้องการจุดเดียว ให้ใช้แท็บอัตราเร็ว ณ จุด</p>'
      : '<strong>เลือกจุดบนกระดาษ 1 จุดขึ้นไป</strong><p>จุดเดียวใช้หาอัตราเร็ว ณ จุดได้ ส่วนค่าเฉลี่ยต้องเลือก 2 จุด</p>';
    els.solutionContent.innerHTML = `<div class="solution-empty">${message}</div>`;
    return;
  }

  els.selectedPeriodBadge.textContent = `Δt = ${data.periods}/50 s`;
  const startName = referenceName(data.start.index);
  const endName = referenceName(data.end.index);
  const selectedReading = solutionReadingMarkup(data);
  const commonBullets = [
    `จุด ${startName} อยู่ที่ S<sub>${startName}</sub> = ${formatNumber(data.start.x)} cm`,
    `จุด ${endName} อยู่ที่ S<sub>${endName}</sub> = ${formatNumber(data.end.x)} cm`,
    `เครื่องเคาะ 50 ครั้ง/วินาที → เวลาระหว่างจุด = ${fraction('1', '50')} s`,
    `จุด ${startName} ถึง ${endName} มี ${data.periods} ช่วง → Δt = ${fraction(data.periods, '50')} s = ${formatNumber(data.dt, 3)} s`
  ];

  if (state.solutionType === 'speed') {
    const equations = [
      `อัตราเร็วเฉลี่ย = ${fraction('S<sub>รวม</sub>', 'Δt')}`,
      `= ${fraction(formatNumber(data.distance), `${data.periods}/50`)}`,
      `= ${fraction(formatNumber(data.distance), formatNumber(data.dt, 3))}`,
      `= ${formatNumber(data.avgSpeed)} cm/s`
    ];
    els.solutionContent.innerHTML = workedSolutionMarkup(
      `ข้อ: หาอัตราเร็วเฉลี่ยระหว่างจุด ${startName}–${endName}`,
      commonBullets,
      equations,
      `อัตราเร็วเฉลี่ย = ${formatNumber(data.avgSpeed)} cm/s`,
      'อัตราเร็วใช้ระยะทางรวม จึงไม่มีเครื่องหมายบอกทิศทาง',
      selectedReading
    );
  } else if (state.solutionType === 'velocity') {
    const equations = [
      `ΔS = S<sub>${endName}</sub> − S<sub>${startName}</sub> = ${formatNumber(data.end.x)} − ${formatNumber(data.start.x)} = ${formatNumber(data.displacement)} cm`,
      `v̄ = ${fraction('ΔS', 'Δt')}`,
      `= ${fraction(formatNumber(data.displacement), `${data.periods}/50`)}`,
      `= ${formatNumber(data.avgVelocity)} cm/s`
    ];
    els.solutionContent.innerHTML = workedSolutionMarkup(
      `ข้อ: หาความเร็วเฉลี่ยระหว่างจุด ${startName}–${endName}`,
      commonBullets,
      equations,
      `ความเร็วเฉลี่ย = ${formatNumber(data.avgVelocity)} cm/s ${data.avgVelocity >= 0 ? 'ไปทางขวา' : 'ไปทางซ้าย'}`,
      'ความเร็วเฉลี่ยใช้การกระจัด เครื่องหมายจึงใช้บอกทิศทาง',
      selectedReading
    );
  } else if (state.solutionType === 'acceleration') {
    const velocityA = localVelocity(data.start.index);
    const velocityB = localVelocity(data.end.index);
    const acceleration = (velocityB.value - velocityA.value) / data.dt;
    const equations = [
      `v<sub>${startName}</sub> = ${fraction(`${formatNumber(velocityA.after.x)} − ${formatNumber(velocityA.before.x)}`, `${velocityA.intervals}/50`)} = ${formatNumber(velocityA.value)} cm/s`,
      `v<sub>${endName}</sub> = ${fraction(`${formatNumber(velocityB.after.x)} − ${formatNumber(velocityB.before.x)}`, `${velocityB.intervals}/50`)} = ${formatNumber(velocityB.value)} cm/s`,
      `ā = ${fraction(`v<sub>${endName}</sub> − v<sub>${startName}</sub>`, `t<sub>${endName}</sub> − t<sub>${startName}</sub>`)}`,
      `= ${fraction(`${formatNumber(velocityB.value)} − ${formatNumber(velocityA.value)}`, `${data.end.index}/50 − ${data.start.index}/50`)}`,
      `= ${fraction(formatNumber(velocityB.value - velocityA.value), `${data.periods}/50`)} = ${formatNumber(acceleration)} cm/s²`
    ];
    els.solutionContent.innerHTML = workedSolutionMarkup(
      `ข้อ: หาความเร่งเฉลี่ยระหว่างจุด ${startName}–${endName}`,
      commonBullets,
      equations,
      `ความเร่งเฉลี่ย = ${formatNumber(acceleration)} cm/s²`,
      state.source === 'manual' ? 'ข้อมูลจากการลากอาจแกว่งตามมือ ควรเลือกจุดห่างกันพอสมควรแล้วเทียบหลายช่วง' : 'เครื่องหมายลบหมายถึงความเร่งมีทิศตรงข้ามกับทิศบวก',
      solutionReadingMarkup(data, [velocityA.beforeIndex, velocityA.index, velocityA.afterIndex, velocityB.beforeIndex, velocityB.index, velocityB.afterIndex])
    );
  } else {
    const intervalAcceleration = data.avgAcceleration;
    const predictedVelocity = data.start.v + intervalAcceleration * data.dt;
    const predictedDisplacement = data.start.v * data.dt + 0.5 * intervalAcceleration * data.dt * data.dt;
    const equations = [
      `v = u + at`,
      `= ${formatNumber(data.start.v)} + (${formatNumber(intervalAcceleration)})(${fraction(data.periods, '50')}) = ${formatNumber(predictedVelocity)} cm/s`,
      `ΔS = ut + ${fraction('1', '2')}at²`,
      `= (${formatNumber(data.start.v)})(${fraction(data.periods, '50')}) + ${fraction('1', '2')}(${formatNumber(intervalAcceleration)})(${fraction(data.periods, '50')})²`,
      `= ${formatNumber(predictedDisplacement)} cm`
    ];
    els.solutionContent.innerHTML = workedSolutionMarkup(
      'ข้อ: ตรวจคำตอบด้วยสมการการเคลื่อนที่',
      [...commonBullets, `กำหนด u = ${formatNumber(data.start.v)} cm/s และ a = ${formatNumber(intervalAcceleration)} cm/s²`],
      equations,
      `ได้ ΔS = ${formatNumber(predictedDisplacement)} cm · จากแถบจริง ${formatNumber(data.displacement)} cm`,
      state.source === 'manual' ? 'ใช้ได้เป็นค่าประมาณเมื่อการลากมีความเร่งใกล้คงที่ ถ้ามือเปลี่ยนแรงบ่อยให้เลือกช่วงสั้นลง' : 'สมการชุดนี้ใช้ได้ตรงเมื่อความเร่งคงที่ในช่วง A–B',
      selectedReading
    );
  }
}

function niceTickStep(range, targetTicks) {
  const roughStep = Math.max(Number.EPSILON, range / Math.max(1, targetTicks));
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function niceAxisScale(values, targetTicks) {
  let dataMin = Math.min(...values, 0);
  let dataMax = Math.max(...values, 0);
  if (Math.abs(dataMax - dataMin) < 1e-9) {
    const spread = Math.max(1, Math.abs(dataMax) * 0.2);
    dataMin -= spread;
    dataMax += spread;
  }

  const step = niceTickStep(dataMax - dataMin, targetTicks);
  const min = Math.floor(dataMin / step) * step;
  const max = Math.ceil(dataMax / step) * step;
  const count = Math.max(1, Math.round((max - min) / step));
  const ticks = Array.from({ length: count + 1 }, (_, index) => min + index * step);
  return { min, max, step, ticks };
}

function axisTickDigits(step) {
  if (step >= 1) return Number.isInteger(step) ? 0 : 1;
  return Math.min(4, Math.max(1, Math.ceil(-Math.log10(step)) + 1));
}

function formatAxisTick(value, step) {
  const digits = axisTickDigits(step);
  const clean = Math.abs(value) < step / 1000 ? 0 : value;
  return clean.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function roundedRectanglePath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawGraph() {
  if (!state.points.length || !els.graphDialog.open) return;

  const canvas = els.chart;
  const bounds = canvas.getBoundingClientRect();
  const cssWidth = Math.max(280, canvas.clientWidth || Math.round(bounds.width) || 900);
  const cssHeight = Math.max(220, canvas.clientHeight || Math.round(bounds.height) || cssWidth * 0.5);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const bitmapWidth = Math.round(cssWidth * dpr);
  const bitmapHeight = Math.round(cssHeight * dpr);
  if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
    canvas.width = bitmapWidth;
    canvas.height = bitmapHeight;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const paper = cssToken('--color-surface');
  const ink = cssToken('--color-ink');
  const muted = cssToken('--color-muted');
  const rule = cssToken('--color-rule');
  const accent = cssToken('--color-accent');
  const selectA = cssToken('--color-selection-a');
  const selectB = cssToken('--color-selection-b');
  const fontBody = cssToken('--font-body');
  const graphType = els.graphType.value;
  const field = graphType === 'position' ? 'x' : graphType === 'velocity' ? 'v' : 'a';
  const ySymbol = graphType === 'position' ? 'S' : graphType === 'velocity' ? 'v' : 'a';
  const yUnit = graphType === 'position' ? 'cm' : graphType === 'velocity' ? 'cm/s' : 'cm/s²';
  const unit = graphType === 'position' ? 'S (cm)' : graphType === 'velocity' ? 'v (cm/s)' : 'a (cm/s²)';
  const plottedPoints = state.source === 'auto' ? state.points.slice(0, state.currentIndex + 1) : state.points;
  const values = state.points.map(point => point[field]);
  const yTargetTicks = clamp(Math.floor((cssHeight - 90) / 64), 4, 8);
  const xTargetTicks = clamp(Math.floor((cssWidth - 90) / 100), 4, 10);
  const yScale = niceAxisScale(values, yTargetTicks);
  const maxTime = Math.max(PERIOD, state.points[state.points.length - 1].t);
  const xScale = niceAxisScale([0, maxTime], xTargetTicks);
  const labelFontSize = cssWidth < 560 ? 11 : 12;

  ctx.font = `${labelFontSize}px ${fontBody}`;
  const widestYLabel = Math.max(...yScale.ticks.map(value => ctx.measureText(formatAxisTick(value, yScale.step)).width));
  const pad = {
    left: Math.max(54, Math.ceil(widestYLabel) + 20),
    right: cssWidth < 560 ? 14 : 24,
    top: cssHeight < 360 ? 32 : 40,
    bottom: cssHeight < 360 ? 46 : 54
  };
  const plotW = Math.max(1, cssWidth - pad.left - pad.right);
  const plotH = Math.max(1, cssHeight - pad.top - pad.bottom);
  const xAt = time => pad.left + ((time - xScale.min) / (xScale.max - xScale.min)) * plotW;
  const yAt = value => pad.top + ((yScale.max - value) / (yScale.max - yScale.min)) * plotH;
  graphGeometry = { cssWidth, cssHeight, pad, plotW, plotH, xScale };

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  ctx.strokeStyle = rule;
  ctx.lineWidth = 1;
  ctx.fillStyle = muted;
  ctx.font = `${labelFontSize}px ${fontBody}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  yScale.ticks.forEach(value => {
    const y = yAt(value);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(cssWidth - pad.right, y);
    ctx.stroke();
    ctx.fillText(formatAxisTick(value, yScale.step), pad.left - 8, y);
  });

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  xScale.ticks.forEach(value => {
    const x = xAt(value);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotH);
    ctx.stroke();
    ctx.fillText(formatAxisTick(value, xScale.step), x, pad.top + plotH + 9);
  });

  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();

  ctx.fillStyle = ink;
  ctx.font = `600 ${cssWidth < 560 ? 12 : 13}px ${fontBody}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(unit, pad.left, 8);
  ctx.textAlign = 'center';
  ctx.fillText('เวลา t (s)', pad.left + plotW / 2, cssHeight - 20);

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, plotW, plotH);
  ctx.clip();

  ctx.strokeStyle = accent;
  ctx.lineWidth = cssWidth < 560 ? 2 : 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  plottedPoints.forEach((point, index) => {
    const x = xAt(point.t);
    const y = yAt(point[field]);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const selectedMarkers = state.selectedDots.map((index, markerIndex) => ({
    index,
    label: referenceLabel(markerIndex),
    color: markerIndex % 2 === 0 ? selectA : selectB
  }));
  selectedMarkers.forEach(marker => {
    const point = state.points[marker.index];
    if (!point) return;
    const x = xAt(point.t);
    const y = yAt(point[field]);
    ctx.strokeStyle = marker.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotH);
    ctx.stroke();
    ctx.fillStyle = marker.color;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  });

  const activePoint = state.points[state.currentIndex];
  if (activePoint) {
    const activeX = xAt(activePoint.t);
    const activeY = yAt(activePoint[field]);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(activeX, pad.top);
    ctx.lineTo(activeX, pad.top + plotH);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(activeX, activeY, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.font = `700 ${labelFontSize}px ${fontBody}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  selectedMarkers.forEach((marker, markerIndex) => {
    const point = state.points[marker.index];
    if (!point) return;
    const x = clamp(xAt(point.t), pad.left + 9, pad.left + plotW - 9);
    ctx.fillStyle = marker.color;
    ctx.fillText(marker.label, x, pad.top + 7 + (markerIndex % 2) * (labelFontSize + 3));
  });

  const maximumInspectionIndex = state.source === 'auto' ? state.currentIndex : state.points.length - 1;
  const requestedInspectionIndex = Number.isInteger(state.graphPointerIndex)
    ? state.graphPointerIndex
    : state.currentIndex;
  const inspectionIndex = clamp(requestedInspectionIndex, 0, maximumInspectionIndex);
  const inspectionPoint = state.points[inspectionIndex];
  if (inspectionPoint) {
    const pointX = xAt(inspectionPoint.t);
    const pointY = yAt(inspectionPoint[field]);
    const referenceIndex = state.selectedDots.indexOf(inspectionIndex);
    const referencePrefix = referenceIndex >= 0 ? `${referenceLabel(referenceIndex)} · ` : '';
    const pairName = `${referencePrefix}(t, ${ySymbol})`;
    const pairValue = `(${formatNumber(inspectionPoint.t)} s, ${formatNumber(inspectionPoint[field])} ${yUnit})`;

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.left, pad.top, plotW, plotH);
    ctx.clip();
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, pointY);
    ctx.lineTo(pointX, pointY);
    ctx.moveTo(pointX, pointY);
    ctx.lineTo(pointX, pad.top + plotH);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = paper;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pointX, pointY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const tooltipFontSize = cssWidth < 560 ? 10 : 11;
    const tooltipLineHeight = tooltipFontSize + 4;
    const tooltipPaddingX = 8;
    const tooltipPaddingY = 6;
    ctx.font = `700 ${tooltipFontSize}px ${fontBody}`;
    const tooltipTextWidth = Math.max(ctx.measureText(pairName).width, ctx.measureText(pairValue).width);
    const tooltipWidth = tooltipTextWidth + tooltipPaddingX * 2;
    const tooltipHeight = tooltipLineHeight * 2 + tooltipPaddingY * 2;
    const plotRight = pad.left + plotW;
    const plotBottom = pad.top + plotH;
    let tooltipX = pointX + 12;
    if (tooltipX + tooltipWidth > plotRight - 4) tooltipX = pointX - tooltipWidth - 12;
    tooltipX = clamp(tooltipX, pad.left + 4, plotRight - tooltipWidth - 4);
    let tooltipY = pointY - tooltipHeight - 12;
    if (tooltipY < pad.top + 4) tooltipY = pointY + 12;
    tooltipY = clamp(tooltipY, pad.top + 4, plotBottom - tooltipHeight - 4);

    roundedRectanglePath(ctx, tooltipX, tooltipY, tooltipWidth, tooltipHeight, 7);
    ctx.fillStyle = paper;
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(pairName, tooltipX + tooltipPaddingX, tooltipY + tooltipPaddingY);
    ctx.font = `600 ${tooltipFontSize}px ${fontBody}`;
    ctx.fillText(pairValue, tooltipX + tooltipPaddingX, tooltipY + tooltipPaddingY + tooltipLineHeight);

    els.chart.setAttribute(
      'aria-label',
      `กราฟการเคลื่อนที่ คู่อันดับ ${pairName} เท่ากับ ${formatNumber(inspectionPoint.t)} วินาที และ ${formatNumber(inspectionPoint[field])} ${yUnit}`
    );
  }
}

function inspectGraphPoint(event) {
  if (!graphGeometry || !state.points.length) return;
  const rect = els.chart.getBoundingClientRect();
  if (!rect.width) return;
  const canvasX = ((event.clientX - rect.left) / rect.width) * graphGeometry.cssWidth;
  const timeRatio = clamp((canvasX - graphGeometry.pad.left) / graphGeometry.plotW, 0, 1);
  const targetTime = graphGeometry.xScale.min
    + timeRatio * (graphGeometry.xScale.max - graphGeometry.xScale.min);
  const availablePoints = state.source === 'auto'
    ? state.points.slice(0, state.currentIndex + 1)
    : state.points;
  let nearestPoint = availablePoints[0];
  let nearestDistance = Math.abs(nearestPoint.t - targetTime);
  availablePoints.slice(1).forEach(point => {
    const distance = Math.abs(point.t - targetTime);
    if (distance < nearestDistance) {
      nearestPoint = point;
      nearestDistance = distance;
    }
  });
  if (state.graphPointerIndex === nearestPoint.index) return;
  state.graphPointerIndex = nearestPoint.index;
  drawGraph();
}

function clearGraphInspection(event) {
  if (event.pointerType === 'touch' || state.graphPointerIndex === null) return;
  state.graphPointerIndex = null;
  drawGraph();
}

function animateStriker() {
  if (motionQuery.matches || !els.striker.animate) return;
  els.striker.animate(
    [
      { transform: 'translateX(-50%) translateY(-5px)' },
      { transform: 'translateX(-50%) translateY(9px)', offset: 0.5 },
      { transform: 'translateX(-50%) translateY(-5px)' }
    ],
    { duration: 1000 / FREQUENCY, easing: 'linear' }
  );
}

function ensureAutomaticSource() {
  if (state.source === 'manual') regenerateSimulation();
}

function playSimulation() {
  ensureAutomaticSource();
  if (state.currentIndex >= state.points.length - 1) state.currentIndex = 0;
  if (state.running) return;
  state.running = true;
  const interval = (1000 / FREQUENCY) / readSettings().playbackRate;
  state.runTimer = window.setInterval(() => {
    if (state.currentIndex >= state.points.length - 1) {
      pauseSimulation();
      renderFrame();
      return;
    }
    state.currentIndex += 1;
    animateStriker();
    renderFrame();
    keepCurrentDotVisible();
  }, interval);
  renderFrame();
}

function pauseSimulation() {
  if (state.runTimer) window.clearInterval(state.runTimer);
  state.runTimer = null;
  state.running = false;
  updateTransportState();
  renderReadouts();
}

function stepSimulation() {
  ensureAutomaticSource();
  pauseSimulation();
  if (state.currentIndex < state.points.length - 1) state.currentIndex += 1;
  animateStriker();
  renderFrame();
  keepCurrentDotVisible();
}

function updateTransportState() {
  els.playBtn.disabled = state.running || state.dragging;
  els.pauseBtn.disabled = !state.running && !state.dragging;
  els.stepBtn.disabled = state.running || state.dragging;
}

function keepCurrentDotVisible() {
  const dot = els.tape.querySelector(`[data-index="${state.currentIndex}"]`);
  dot?.scrollIntoView({ behavior: motionQuery.matches ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
}

function pointerToManualPosition(event) {
  const rect = els.labStage.getBoundingClientRect();
  const cartWidth = els.cart.offsetWidth || 160;
  const base = rect.width >= 640 ? 112 : 83;
  const available = Math.max(20, rect.width - base - cartWidth - 24);
  const center = event.clientX - state.dragPointerOffset - rect.left - base - cartWidth / 2;
  return clamp((center / available) * 120, 0, 120);
}

function beginManualDrag(event) {
  if (event.button !== 0 && event.pointerType !== 'touch') return;
  pauseSimulation();
  const startPoint = currentPoint();
  const cartRect = els.cart.getBoundingClientRect();
  state.dragPointerOffset = event.clientX - (cartRect.left + cartRect.width / 2);
  state.dragging = true;
  state.source = 'manual';
  state.dragX = clamp(startPoint.x, 0, 120);
  state.points = [{ index: 0, t: 0, x: state.dragX, v: 0, a: 0 }];
  state.currentIndex = 0;
  state.selectedDots = [];
  els.cart.classList.add('is-dragging');
  els.cart.setPointerCapture?.(event.pointerId);
  state.manualTimer = window.setInterval(recordManualTick, 1000 / FREQUENCY);
  renderStatic();
  renderFrame();
  event.preventDefault();
}

function moveManualDrag(event) {
  if (!state.dragging) return;
  state.dragX = pointerToManualPosition(event);
  const point = currentPoint();
  point.x = state.dragX;
  recalculateManualKinematics();
  renderFrame();
  event.preventDefault();
}

function recordManualTick() {
  if (!state.dragging || state.points.length > MAX_MANUAL_PERIODS) {
    endManualDrag();
    return;
  }
  const index = state.points.length;
  state.points.push({ index, t: index * PERIOD, x: state.dragX, v: 0, a: 0 });
  state.currentIndex = index;
  recalculateManualKinematics();
  animateStriker();
  renderTape(els.tape, false);
  renderFrame();
}

function endManualDrag(event) {
  if (!state.dragging) return;
  if (state.manualTimer) window.clearInterval(state.manualTimer);
  state.manualTimer = null;
  state.dragging = false;
  els.cart.classList.remove('is-dragging');
  if (event?.pointerId !== undefined) els.cart.releasePointerCapture?.(event.pointerId);
  recalculateManualKinematics();
  renderStatic();
  renderFrame();
}

function recalculateManualKinematics() {
  const points = state.points;
  if (points.length < 2) return;
  points.forEach((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dt = Math.max(PERIOD, next.t - previous.t);
    point.v = (next.x - previous.x) / dt;
  });
  points.forEach((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dt = Math.max(PERIOD, next.t - previous.t);
    point.a = (next.v - previous.v) / dt;
  });
}

function recordKeyboardStep(direction) {
  pauseSimulation();
  if (state.source !== 'manual') {
    const start = currentPoint();
    state.source = 'manual';
    state.points = [{ index: 0, t: 0, x: clamp(start.x, 0, 120), v: 0, a: 0 }];
    state.selectedDots = [];
  }
  if (state.points.length > MAX_MANUAL_PERIODS) return;
  const previous = state.points[state.points.length - 1];
  const index = state.points.length;
  state.points.push({ index, t: index * PERIOD, x: clamp(previous.x + direction * 2, 0, 120), v: 0, a: 0 });
  state.currentIndex = index;
  recalculateManualKinematics();
  animateStriker();
  renderStatic();
  renderFrame();
}

function openGraphDialog() {
  if (!els.graphDialog.open) els.graphDialog.showModal();
  window.requestAnimationFrame(() => {
    drawGraph();
    els.graphType.focus({ preventScroll: true });
  });
}

function toggleSolution() {
  state.solutionVisible = !state.solutionVisible;
  els.solutionPanel.classList.toggle('is-hidden', !state.solutionVisible);
  els.toggleSolutionBtn.setAttribute('aria-expanded', String(state.solutionVisible));
  document.body.classList.toggle('solution-hidden', !state.solutionVisible);
}

function openPaperDialog() {
  els.paperDialogSummary.textContent = 'แถบกระดาษทั้งแผ่น · ไม้บรรทัดแบ่งละเอียดทุก 1 mm';
  if (!els.paperDialog.open) els.paperDialog.showModal();
  window.requestAnimationFrame(() => {
    renderTape(els.fullTape, true);
    els.fullTapeViewport.scrollLeft = 0;
  });
}

function closeOnBackdrop(event) {
  if (event.target === event.currentTarget) event.currentTarget.close();
}

function handleSolutionTab(event) {
  const button = event.currentTarget;
  state.solutionType = button.dataset.solution;
  els.solutionTabs.forEach(tab => {
    const active = tab === button;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  renderSolution();
}

function handleResize() {
  window.clearTimeout(handleResize.timer);
  handleResize.timer = window.setTimeout(() => {
    renderTape(els.tape, false);
    renderTape(els.fullTape, true);
    renderStage();
    drawGraph();
  }, 120);
}

els.playBtn.addEventListener('click', playSimulation);
els.pauseBtn.addEventListener('click', () => {
  if (state.dragging) endManualDrag();
  else pauseSimulation();
});
els.stepBtn.addEventListener('click', stepSimulation);
els.resetBtn.addEventListener('click', regenerateSimulation);
els.clearSelectionBtn.addEventListener('click', clearSelection);
els.toggleGraphBtn.addEventListener('click', openGraphDialog);
els.toggleSolutionBtn.addEventListener('click', toggleSolution);
els.graphType.addEventListener('change', drawGraph);
els.chart.addEventListener('pointerdown', inspectGraphPoint);
els.chart.addEventListener('pointermove', inspectGraphPoint);
els.chart.addEventListener('pointerleave', clearGraphInspection);
els.solutionTabs.forEach(tab => tab.addEventListener('click', handleSolutionTab));
[els.tape, els.fullTape].forEach(tape => {
  tape.addEventListener('click', handleTapeClick);
  tape.addEventListener('pointermove', handleTapePointerMove);
  tape.addEventListener('pointerleave', handleTapePointerLeave);
});
els.startReference.addEventListener('change', () => {
  renderSolution();
  drawGraph();
});
els.endReference.addEventListener('change', () => {
  renderSolution();
  drawGraph();
});

els.closeGraphBtn.addEventListener('click', () => {
  state.graphPointerIndex = null;
  els.graphDialog.close();
});
els.graphDialog.addEventListener('click', closeOnBackdrop);
els.graphDialog.addEventListener('close', () => {
  state.graphPointerIndex = null;
});

els.openSettingsBtn.addEventListener('click', () => {
  syncSettingsUi();
  els.settingsDialog.showModal();
  window.setTimeout(() => els.motionMode.focus(), 0);
});
els.motionMode.addEventListener('change', syncSettingsUi);
els.v0.addEventListener('input', syncSettingsUi);
els.acc.addEventListener('input', syncSettingsUi);
els.duration.addEventListener('input', syncSettingsUi);
els.applySettingsBtn.addEventListener('click', () => {
  regenerateSimulation();
  els.settingsDialog.close();
});
els.settingsDialog.addEventListener('click', closeOnBackdrop);

els.openPaperBtn.addEventListener('click', openPaperDialog);
els.closePaperBtn.addEventListener('click', () => els.paperDialog.close());
els.paperDialog.addEventListener('click', closeOnBackdrop);

els.cart.addEventListener('pointerdown', beginManualDrag);
els.labStage.addEventListener('pointermove', moveManualDrag);
els.labStage.addEventListener('pointerup', endManualDrag);
els.labStage.addEventListener('pointercancel', endManualDrag);
els.cart.addEventListener('keydown', event => {
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault();
    recordKeyboardStep(event.key === 'ArrowRight' ? 1 : -1);
  }
});

window.addEventListener('resize', handleResize);
window.addEventListener('beforeunload', () => {
  pauseSimulation();
  if (state.manualTimer) window.clearInterval(state.manualTimer);
  graphResizeObserver?.disconnect();
});

syncSettingsUi();
regenerateSimulation();
