/* Signature pads for the PRIDE Training Log. Loaded as the global `PrideSignature`.
   - mount(container, { onChange }) turns a `.sig-pad` element (with a <canvas> and a .sig-clear button)
     into a drawing pad that works with a mouse, finger or stylus.
   - Signatures are stored as small PNG data URLs. isValidDataUrl / safeImageSrc are the only gate
     before one is ever put into an <img> or a PDF, because the value comes from the database. */
const PrideSignature = (() => {
  const MAX_DATA_URL = 150000; // ~110 KB of image: far below Firestore's 1 MB document limit
  const PNG_PREFIX = 'data:image/png;base64,';
  const INK = '#1B1A17';

  function isValidDataUrl(v) {
    return typeof v === 'string'
      && v.startsWith(PNG_PREFIX)
      && v.length > PNG_PREFIX.length
      && v.length <= MAX_DATA_URL
      && /^[A-Za-z0-9+/=]+$/.test(v.slice(PNG_PREFIX.length));
  }
  const safeImageSrc = v => (isValidDataUrl(v) ? v : '');

  function mount(container, { onChange } = {}) {
    const canvas = container.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const clearBtn = container.querySelector('.sig-clear');
    let drawing = false, last = null, mid = null, dirty = false;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;

    const scale = () => canvas.width / canvas.getBoundingClientRect().width;
    function point(e) {
      const r = canvas.getBoundingClientRect(), k = scale();
      return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, p: e.pressure > 0 && e.pointerType === 'pen' ? e.pressure : 0.5 };
    }
    function markDirty() {
      if (!dirty) { dirty = true; container.classList.add('has-ink'); }
      if (onChange) onChange();
    }

    canvas.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
      drawing = true;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is a nicety */ }
      last = point(e);
      mid = last;
      ctx.lineWidth = (1.6 + last.p * 3) * scale() * 0.9;
      ctx.beginPath();
      ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2); // a tap leaves a dot
      ctx.fillStyle = INK;
      ctx.fill();
      markDirty();
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drawing) return;
      const p = point(e);
      const m = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
      ctx.lineWidth = (1.6 + p.p * 3) * scale() * 0.9;
      ctx.beginPath();
      ctx.moveTo(mid.x, mid.y);
      ctx.quadraticCurveTo(last.x, last.y, m.x, m.y); // smooth the stroke through the midpoints
      ctx.stroke();
      last = p;
      mid = m;
      e.preventDefault();
    });
    const stop = () => { drawing = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.addEventListener('pointerleave', stop);

    function clear(silent) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      dirty = false;
      container.classList.remove('has-ink');
      if (onChange && !silent) onChange();
    }
    if (clearBtn) clearBtn.addEventListener('click', () => clear());

    // A PNG of the ink on a transparent background; drops to half size if it is somehow too big
    function toDataURL() {
      if (!dirty) return '';
      let url = canvas.toDataURL('image/png');
      if (url.length > MAX_DATA_URL) {
        const small = document.createElement('canvas');
        small.width = canvas.width / 2;
        small.height = canvas.height / 2;
        small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
        url = small.toDataURL('image/png');
      }
      return url;
    }
    function load(url) {
      clear(true);
      if (!isValidDataUrl(url)) return Promise.resolve();
      return new Promise(resolve => {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); dirty = true; container.classList.add('has-ink'); resolve(); };
        img.onerror = () => resolve();
        img.src = url;
      });
    }

    return { clear, isEmpty: () => !dirty, toDataURL, load };
  }

  return { MAX_DATA_URL, isValidDataUrl, safeImageSrc, mount };
})();

if (typeof module !== 'undefined') module.exports = PrideSignature;
