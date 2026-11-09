// Journal figures: placeholders for images that aren't exported yet, and a full-screen viewer.
document.addEventListener('DOMContentLoaded', () => {
  const links = [...document.querySelectorAll('a.fig-zoom')];
  if (!links.length) return;

  // Swap a failed image for a labelled box; the figure's own caption stays with it.
  const showMissing = (link, img) => {
    const box = document.createElement('div');
    box.className = 'fig-missing';
    const label = document.createElement('span');
    label.textContent = 'Image not exported yet';
    const file = document.createElement('code');
    file.textContent = img.getAttribute('src').split('/').pop();
    box.append(label, file);
    link.closest('.fig').classList.add('is-missing');
    link.replaceWith(box);
  };

  links.forEach(link => {
    const img = link.querySelector('img');
    if (!img) return; // inline SVG figure
    if (img.complete && img.naturalWidth === 0) showMissing(link, img);
    else img.addEventListener('error', () => showMissing(link, img), { once: true });
  });

  // Viewer
  const dialog = document.createElement('dialog');
  if (typeof dialog.showModal !== 'function') return; // links still open the image directly

  dialog.className = 'lb';
  dialog.setAttribute('aria-label', 'Image viewer');
  dialog.innerHTML = `
    <div class="lb-bar">
      <span class="lb-title"></span>
      <button type="button" class="lb-btn" data-act="out" aria-label="Zoom out">&minus;</button>
      <button type="button" class="lb-btn" data-act="in" aria-label="Zoom in">+</button>
      <button type="button" class="lb-btn" data-act="close" aria-label="Close">Close</button>
    </div>
    <div class="lb-stage"><img class="lb-img" alt="" draggable="false"></div>`;
  document.body.append(dialog);

  const bar = dialog.querySelector('.lb-bar');
  const title = dialog.querySelector('.lb-title');
  const stage = dialog.querySelector('.lb-stage');
  const view = dialog.querySelector('.lb-img');

  const MAX_SCALE = 8;
  const BUTTON_STEP = 1.5;
  const TAP_SLOP = 6;
  const DOUBLE_TAP_MS = 300;

  let scale = 1, tx = 0, ty = 0;

  const render = () => {
    const maxX = Math.max(0, (view.offsetWidth * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (view.offsetHeight * scale - stage.clientHeight) / 2);
    tx = Math.min(maxX, Math.max(-maxX, tx));
    ty = Math.min(maxY, Math.max(-maxY, ty));
    view.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    stage.classList.toggle('is-zoomed', scale > 1);
  };

  const reset = () => { scale = 1; tx = 0; ty = 0; render(); };

  // Zoom keeping the point under (clientX, clientY) fixed.
  const zoomTo = (next, clientX, clientY) => {
    const r = stage.getBoundingClientRect();
    const px = (clientX ?? r.left + r.width / 2) - r.left - r.width / 2;
    const py = (clientY ?? r.top + r.height / 2) - r.top - r.height / 2;
    next = Math.min(MAX_SCALE, Math.max(1, next));
    tx = px - (px - tx) * (next / scale);
    ty = py - (py - ty) * (next / scale);
    scale = next;
    render();
  };

  // An inline SVG takes its colors from the page, so copy them in before showing it as an image.
  const SVG_STYLES = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'font-family', 'font-size', 'font-weight'];
  const svgToImage = (svg) => {
    const copy = svg.cloneNode(true);
    const originals = svg.querySelectorAll('*');
    copy.querySelectorAll('*').forEach((el, i) => {
      const style = getComputedStyle(originals[i]);
      SVG_STYLES.forEach(name => el.style.setProperty(name, style.getPropertyValue(name)));
    });
    const { width, height } = svg.viewBox.baseVal;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', width * 2);
    copy.setAttribute('height', height * 2);
    return `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  };

  const open = (link) => {
    const svg = link.querySelector('svg');
    view.src = svg ? svgToImage(svg) : link.href;
    view.alt = svg ? svg.getAttribute('aria-label') : link.querySelector('img').alt;
    title.textContent = link.closest('.fig').querySelector('figcaption')?.textContent.trim() ?? '';
    document.documentElement.classList.add('lb-open');
    dialog.showModal();
    reset();
  };

  // Pointer input: drag pans, two fingers pinch, a click outside the image closes.
  const pointers = new Map();
  let start = null, moved = false, pinch = null, lastTap = 0;

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { start = { x: e.clientX, y: e.clientY }; moved = false; }
    pinch = null;
  });

  stage.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (pointers.size === 1) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) moved = true;
      if (moved && scale > 1) {
        stage.classList.add('is-dragging');
        tx += dx; ty += dy;
        render();
      }
    } else if (pointers.size === 2) {
      moved = true;
      const [a, b] = [...pointers.values()];
      const now = { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinch) {
        tx += now.x - pinch.x; ty += now.y - pinch.y;
        zoomTo(scale * (now.d / pinch.d), now.x, now.y);
      }
      pinch = now;
    }
  });

  const release = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    pinch = null;
    stage.classList.remove('is-dragging');
    if (e.type !== 'pointerup' || moved || pointers.size) return;

    const r = view.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) { dialog.close(); return; }

    // Double tap or double click toggles zoom.
    if (e.timeStamp - lastTap < DOUBLE_TAP_MS) {
      lastTap = 0;
      if (scale > 1) reset(); else zoomTo(3, e.clientX, e.clientY);
    } else {
      lastTap = e.timeStamp;
    }
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomTo(scale * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
  }, { passive: false });

  bar.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'in') zoomTo(scale * BUTTON_STEP);
    else if (act === 'out') zoomTo(scale / BUTTON_STEP);
    else if (act === 'close' || e.target === bar || e.target === title) dialog.close();
  });

  // Esc is handled natively by <dialog>.
  dialog.addEventListener('keydown', (e) => {
    const PAN = 60;
    if (e.key === '+' || e.key === '=') zoomTo(scale * BUTTON_STEP);
    else if (e.key === '-') zoomTo(scale / BUTTON_STEP);
    else if (e.key === '0') reset();
    else if (e.key === 'ArrowLeft') { tx += PAN; render(); }
    else if (e.key === 'ArrowRight') { tx -= PAN; render(); }
    else if (e.key === 'ArrowUp') { ty += PAN; e.preventDefault(); render(); }
    else if (e.key === 'ArrowDown') { ty -= PAN; e.preventDefault(); render(); }
  });

  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('lb-open');
    view.removeAttribute('src');
    pointers.clear();
  });

  window.addEventListener('resize', () => { if (dialog.open) render(); });
  view.addEventListener('load', () => { if (dialog.open) render(); });

  // Links stay real links: modified clicks open the file, as does a page with no JS.
  document.addEventListener('click', (e) => {
    const link = e.target.closest?.('a.fig-zoom');
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    open(link);
  });
});
