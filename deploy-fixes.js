(function () {
  const MIN_TAPE_SCALE = 32;
  const FIT_TO_VIEW_DOMAIN = 20;
  const TAPE_INSET = 48;
  let hoveredDotIndex = null;

  function fmt(value, digits = 2) {
    const clean = Math.abs(value) < 1e-9 ? 0 : value;
    return clean.toFixed(digits);
  }

  function pointText(point) {
    return `${fmt(point?.x || 0)} cm`;
  }

  function visiblePoints() {
    return state.points.slice(0, Math.max(1, state.currentIndex + 1));
  }

  function tapeLayout() {
    const wrap = els.tape.parentElement;
    const viewportWidth = Math.max(280, wrap?.clientWidth || 760);
    const maxX = Math.max(1, ...state.points.map(point => point.x));
    const domain = Math.max(1, Math.ceil(maxX));
    const fitScale = Math.max(1, (viewportWidth - 2 - TAPE_INSET * 2) / domain);
    const scale = domain <= FIT_TO_VIEW_DOMAIN ? fitScale : Math.max(MIN_TAPE_SCALE, fitScale);
    const width = Math.max(viewportWidth - 2, domain * scale + TAPE_INSET * 2);
    return {
      domain,
      scale,
      width,
      left(value) {
        return TAPE_INSET + value * scale;
      }
    };
  }

  function rulerStepMillimetres(scale) {
    const pxPerMillimetre = scale / 10;
    if (pxPerMillimetre >= 1.4) return 1;
    if (pxPerMillimetre >= 0.8) return 5;
    return 10;
  }

  function patchedDrawRuler(layout) {
    els.ruler.innerHTML = '';
    const unit = document.createElement('div');
    unit.className = 'ruler-unit';
    unit.textContent = 'cm';
    els.ruler.appendChild(unit);

    const totalMillimetres = Math.ceil(layout.domain * 10);
    const step = rulerStepMillimetres(layout.scale);
    for (let mm = 0; mm <= totalMillimetres; mm += step) {
      const cm = mm / 10;
      const isCm = mm % 10 === 0;
      const isHalfCm = mm % 5 === 0;
      const mark = document.createElement('div');
      mark.className = `ruler-mark ${isCm ? 'major' : isHalfCm ? 'half' : 'minor'}`;
      mark.style.left = `${layout.left(cm)}px`;
      els.ruler.appendChild(mark);

      if (mm > 0 && isCm) {
        const label = document.createElement('div');
        label.className = 'ruler-label';
        label.style.left = `${layout.left(cm)}px`;
        label.textContent = String(cm);
        els.ruler.appendChild(label);
      }
    }
    els.ruler.style.minWidth = `${layout.width}px`;
  }

  function patchedRenderSelectionGuides(layout) {
    els.tape.querySelectorAll('.selection-guide, .selection-ruler-tag').forEach(el => el.remove());
    state.selectedDots.forEach(index => {
      if (index > state.currentIndex) return;
      const point = state.points[index];
      if (!point) return;
      const x = layout.left(point.x);

      const guide = document.createElement('div');
      guide.className = 'selection-guide';
      guide.style.left = `${x}px`;
      els.tape.appendChild(guide);

      const tag = document.createElement('div');
      tag.className = 'selection-ruler-tag';
      tag.style.left = `${x}px`;
      tag.textContent = pointText(point);
      els.tape.appendChild(tag);
    });
  }

  function patchedRefreshDotSelection() {
    document.querySelectorAll('.dot').forEach(dot => {
      const idx = Number(dot.dataset.index);
      dot.classList.toggle('selected', state.selectedDots.includes(idx));
      dot.classList.toggle('current', idx === state.currentIndex);
      dot.classList.toggle('hovered', idx === hoveredDotIndex);
    });
  }

  function patchedRenderTape() {
    const layout = tapeLayout();
    els.tape.style.width = `${layout.width}px`;
    els.ruler.style.width = `${layout.width}px`;
    els.tape.innerHTML = '';
    patchedDrawRuler(layout);

    const s = readSettings();
    visiblePoints().forEach(point => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'dot';
      dot.style.left = `${layout.left(point.x)}px`;
      dot.dataset.index = point.index;
      dot.dataset.distance = pointText(point);
      dot.title = `จุดที่ ${point.index}: t=${fmt(point.t, 3)} s, s=${pointText(point)}`;
      dot.setAttribute('aria-label', `จุดที่ ${point.index} ระยะ ${pointText(point)}`);
      dot.innerHTML = `<span class="dot-distance">${pointText(point)}</span>`;
      els.tape.appendChild(dot);

      if (point.index % s.groupSize === 0) {
        const label = document.createElement('div');
        label.className = 'dot-label';
        label.style.left = `${layout.left(point.x)}px`;
        label.textContent = point.index;
        els.tape.appendChild(label);
      }
    });

    state.groups.forEach(group => {
      if (group.end > state.currentIndex) return;
      const x1 = layout.left(state.points[group.start].x);
      const x2 = layout.left(state.points[group.end].x);
      const bracket = document.createElement('div');
      bracket.className = 'group-bracket';
      bracket.style.left = `${x1}px`;
      bracket.style.width = `${Math.max(8, x2 - x1)}px`;
      bracket.innerHTML = `<span>ช่วง ${group.n}</span>`;
      els.tape.appendChild(bracket);
    });

    patchedRenderSelectionGuides(layout);
    patchedRefreshDotSelection();
  }

  function nearestVisiblePoint(event) {
    const points = visiblePoints();
    if (!points.length) return null;
    const layout = tapeLayout();
    const rect = els.tape.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    let nearest = points[0];
    let best = Math.abs(layout.left(nearest.x) - pointerX);
    points.forEach(point => {
      const distance = Math.abs(layout.left(point.x) - pointerX);
      if (distance < best) {
        nearest = point;
        best = distance;
      }
    });
    return nearest.index;
  }

  function setHoveredDot(index) {
    const next = Number.isInteger(index) ? index : null;
    if (hoveredDotIndex === next) return;
    hoveredDotIndex = next;
    patchedRefreshDotSelection();
  }

  function localVelocity(index) {
    const lastIndex = state.points.length - 1;
    const beforeIndex = index <= 0 ? 0 : index - 1;
    const afterIndex = index >= lastIndex ? lastIndex : index + 1;
    const before = state.points[beforeIndex];
    const after = state.points[afterIndex];
    const dt = Math.max(1 / readSettings().freq, after.t - before.t);
    return {
      beforeIndex,
      afterIndex,
      before,
      after,
      dt,
      value: (after.x - before.x) / dt
    };
  }

  function miniGraph(rows) {
    const points = rows.map(row => row.point).filter(Boolean);
    if (!points.length) return '';
    const min = Math.min(...points.map(point => point.x));
    const max = Math.max(...points.map(point => point.x));
    const span = Math.max(0.001, max - min);
    const markers = rows.map(row => {
      const x = 8 + ((row.point.x - min) / span) * 84;
      return `
        <span class="measure-mini-marker" style="--x: ${x}%">
          <i></i><b>${row.label}</b><small>${pointText(row.point)}</small>
        </span>
      `;
    }).join('');
    return `<div class="measure-mini-graph" aria-hidden="true">${markers}</div>`;
  }

  function patchedUpdateMeasureResult() {
    if (!state.selectedDots.length) {
      els.measureResult.textContent = 'ยังไม่ได้เลือกจุด';
      return;
    }

    const selected = [...state.selectedDots].sort((a, b) => a - b);
    if (selected.length === 1) {
      const index = selected[0];
      const point = state.points[index];
      const v = localVelocity(index);
      els.measureResult.innerHTML = `
        <strong>A = จุด ${index}</strong><br>
        s<sub>A</sub> = ${pointText(point)}, t<sub>A</sub> = ${fmt(point.t, 3)} s<br>
        v<sub>A</sub> ≈ ${fmt(v.value)} cm/s
        <div class="measure-solution">
          <div>ใช้จุดข้างเคียงเพื่อหาอัตราเร็ว ณ จุด A</div>
          <div class="measure-equation">v<sub>A</sub> ≈ (s<sub>${v.afterIndex}</sub> − s<sub>${v.beforeIndex}</sub>) / (t<sub>${v.afterIndex}</sub> − t<sub>${v.beforeIndex}</sub>) = (${fmt(v.after.x)} − ${fmt(v.before.x)}) / ${fmt(v.dt, 3)} = ${fmt(v.value)} cm/s</div>
          ${miniGraph([
            { label: `จุด ${v.beforeIndex}`, point: v.before },
            { label: `A`, point },
            { label: `จุด ${v.afterIndex}`, point: v.after }
          ])}
        </div>
      `;
      return;
    }

    const [a, b] = selected;
    const p1 = state.points[a];
    const p2 = state.points[b];
    const ds = Math.abs(p2.x - p1.x);
    const dt = Math.abs(p2.t - p1.t);
    const speed = ds / Math.max(dt, 0.0001);
    const velocity = (p2.x - p1.x) / Math.max(dt, 0.0001);
    els.measureResult.innerHTML = `
      <strong>A = จุด ${a}, B = จุด ${b}</strong><br>
      Δs = ${fmt(ds)} cm · Δt = ${fmt(dt, 3)} s<br>
      v̄ = ${fmt(speed)} cm/s · ความเร็วเฉลี่ย = ${fmt(velocity)} cm/s
      <div class="measure-solution">
        <div>อ่านระยะของจุด A และ B จากไม้บรรทัด แล้วหารด้วยเวลาระหว่างจุด</div>
        <div class="measure-equation">v̄ = Δs / Δt = |${fmt(p2.x)} − ${fmt(p1.x)}| / ${fmt(dt, 3)} = ${fmt(speed)} cm/s</div>
        ${miniGraph([
          { label: 'A', point: p1 },
          { label: 'B', point: p2 }
        ])}
      </div>
    `;
  }

  function patchedSelectDot(index) {
    if (state.selectedDots.includes(index)) {
      state.selectedDots = state.selectedDots.filter(value => value !== index);
    } else {
      if (state.selectedDots.length >= 2) state.selectedDots.shift();
      state.selectedDots.push(index);
    }
    state.selectedDots.sort((a, b) => a - b);
    patchedRenderTape();
    patchedUpdateMeasureResult();
  }

  function patchedClearMeasurement() {
    state.selectedDots = [];
    setHoveredDot(null);
    patchedRenderTape();
    patchedUpdateMeasureResult();
  }

  function patchedScrollTapeToCurrentDot(point) {
    if (!state.running || !point) return;
    const wrap = els.tape.parentElement;
    const x = tapeLayout().left(point.x);
    const target = Math.max(0, x - wrap.clientWidth * 0.72);
    wrap.scrollTo({ left: target, behavior: 'smooth' });
  }

  renderTape = patchedRenderTape;
  drawRuler = function (_maxX, _scale, _width) { patchedDrawRuler(tapeLayout()); };
  renderSelectionGuides = function () { patchedRenderSelectionGuides(tapeLayout()); };
  refreshDotSelection = patchedRefreshDotSelection;
  updateMeasureResult = patchedUpdateMeasureResult;
  selectDot = patchedSelectDot;
  clearMeasurement = patchedClearMeasurement;
  scrollTapeToCurrentDot = patchedScrollTapeToCurrentDot;

  if (!els.tape.dataset.deployFixesBound) {
    els.tape.dataset.deployFixesBound = 'true';
    els.tape.addEventListener('pointermove', event => setHoveredDot(nearestVisiblePoint(event)));
    els.tape.addEventListener('pointerleave', () => setHoveredDot(null));
    els.tape.addEventListener('click', event => {
      const index = nearestVisiblePoint(event);
      if (Number.isInteger(index)) patchedSelectDot(index);
    });
  }

  const measureHint = document.querySelector('.measure-panel p');
  if (measureHint) {
    measureHint.innerHTML = 'คลิก 1 จุดเพื่อหาอัตราเร็ว ณ จุดนั้น หรือคลิก 2 จุดเพื่อหา Δs, Δt และอัตราเร็วเฉลี่ย';
  }

  renderAll();
})();
