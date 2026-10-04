/* PDF export for the PRIDE Training Log. Loaded as the global `PridePdf`.
   - model(evaluation, notes) turns an evaluation and its leader notes into plain data (pure, unit-tested).
   - render(doc, model, autoTable) draws that data with jsPDF + jspdf-autotable.
   - download(evaluation, notes) loads jsPDF from the CDN on first use (pinned version, integrity hash),
     renders, and saves the file. Nothing is uploaded: the PDF is built in the browser.
   The built-in PDF fonts only cover Latin-1, so every string goes through pdfText(). */
const PridePdf = (() => {
  // Sibling scripts. In the browser a top-level `const` is visible to other scripts but is NOT a property of
  // window, so check by name; under Node (the tests) load them with require.
  const skills = () => (typeof PrideSkills !== 'undefined' ? PrideSkills : require('./softskills.js'));
  const contrib = () => (typeof PrideContrib !== 'undefined' ? PrideContrib : require('./contrib-core.js'));
  const signature = () => (typeof PrideSignature !== 'undefined' ? PrideSignature : require('./signature.js'));

  const LIBS = {
    jspdf: { src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js',
             integrity: 'sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3' },
    autotable: { src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/5.0.8/jspdf.plugin.autotable.min.js',
                 integrity: 'sha384-5jk55M0XWoAw7LyhlXJe19ErOr3doBAPzxw9vahPFbvolqWa2yDk4fhHa2zuYeOa' },
  };

  // ── text and dates ───────────────────────────────────────────────────
  // Latin-1 plus the typographic punctuation that WinAnsi (the PDF default encoding) includes
  const EXTRA_OK = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x20AC, 0x2122]);
  function pdfText(v) {
    return Array.from(String(v == null ? '' : v)).map(ch => {
      const c = ch.codePointAt(0);
      return (c === 10 || c === 9 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || EXTRA_OK.has(c)) ? ch : '?';
    }).join('');
  }

  const toDate = v => {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate();
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d) ? null : d;
  };
  function fmtDate(v) {
    if (!v) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : toDate(v);
    return d ? d.toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: m ? 'UTC' : undefined }) : '—';
  }
  function fmtDateTime(v) {
    const d = toDate(v);
    return d ? d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  }

  function fileName(e, now = new Date()) {
    const who = String(e.tmName || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'Team-Member';
    const day = now.toISOString().slice(0, 10);
    return `PRIDE-Evaluation-${who}-${e.period}Day-${day}.pdf`;
  }

  // ── model ────────────────────────────────────────────────────────────
  function model(e, notes = [], now = new Date()) {
    const S = skills(), C = contrib(), SIG = signature();
    const levelOf = e.roleLevel || (S && S.roleLevel(e.position));
    const area = e.area || (S && S.areaFor(e.position)) || '';

    // Group the (non-retracted) leader notes by section; notes with no/unknown section are General
    const sectionNotes = {};
    const bySkill = {};
    notes.filter(n => !n.retracted).forEach(n => {
      const sec = C.normalizeSection(n.section);
      const item = {
        author: n.authorName || n.authorEmail || 'Leader',
        when: fmtDateTime(n.createdAt),
        text: n.note || '',
        ratingsText: n.ratings ? C.ratingText(n.ratings) : '',
        about: '',
      };
      if (C.isSkillSection(sec)) {
        const id = sec.slice('skill:'.length);
        if (e.softSkills && e.softSkills[id]) { (bySkill[id] = bySkill[id] || []).push(item); return; }
        item.about = C.sectionLabel(sec); // the skill is not on this evaluation: keep the note, name the skill
        (sectionNotes.soft_skills = sectionNotes.soft_skills || []).push(item);
        return;
      }
      (sectionNotes[sec] = sectionNotes[sec] || []).push(item);
    });

    const rows = group => Object.entries(e.softSkills || {})
      .filter(([, s]) => (group === 'leadership') === (s.group === 'leadership'))
      .map(([id, s]) => ({
        id, name: s.name, critical: !!s.critical, rating: s.rating || null,
        ratingLabel: S.scaleLabel(s.rating), note: s.note || '', notes: bySkill[id] || [],
      }));

    const sig = (role, name, img, legacy, at) => ({
      role, name: name || '—', image: SIG && SIG.isValidDataUrl(img) ? img : '', text: legacy || '', signedAt: at ? fmtDateTime(at) : '',
    });

    return {
      fileName: fileName(e, now),
      title: `${e.period}-Day Evaluation`,
      teamMember: e.tmName || '',
      details: [
        ['Team Member', e.tmName || '—'], ['Outlet', e.outlet || '—'],
        ['Position', e.position || '—'], ['Area', area || '—'],
        ['Role level', levelOf === 'leadership' ? 'Leadership' : levelOf === 'line' ? 'Line level' : '—'],
        ['Period', `${e.period}-Day`],
        ['Start date', fmtDate(e.startDate)], ['Evaluation date', fmtDate(e.evalDate)],
        ['Submitted by', e.submittedByName || e.submittedBy || '—'], ['Submitted on', fmtDateTime(e.submittedAt)],
      ],
      flagged: S.flaggedSkills(e.softSkills),
      classes: Object.values(e.classes || {}).map(c => ({ label: c.label, completed: !!c.completed })),
      skills: { all: rows('all'), leadership: rows('leadership') },
      competencies: Object.entries(e.competencies || {}).map(([name, rating]) => ({
        name, rating: rating || null, label: ({ 3: 'Exceeds expectations', 2: 'Meets expectations', 1: 'Needs improvement' })[rating] || 'Not rated',
      })),
      texts: {
        policies: e.policies || '', expectations: e.expectations || '',
        strengths: e.strengths || '', improvements: e.improvements || '', trainerNotes: e.trainerNotes || '',
      },
      sectionNotes,
      signatures: [
        sig('Trainer / Evaluator', e.trainerName, e.trainerSigImg, e.trainerSig, e.trainerSignedAt),
        sig('Team Member', e.tmName, e.tmSigImg, e.tmSig, e.tmSignedAt),
      ],
      manager: e.managerSig || '',
      generatedAt: fmtDateTime(now),
    };
  }

  // ── drawing ──────────────────────────────────────────────────────────
  const COL = {
    ink: [31, 27, 22], muted: [110, 99, 87], gold: [143, 100, 25], goldHi: [232, 200, 115], band: [24, 22, 19],
    line: [221, 211, 189], tint: [250, 245, 232], danger: [176, 58, 46], dangerTint: [252, 236, 233], success: [45, 106, 79],
  };
  const PAGE = { w: 612, h: 792, m: 48, top: 58, bottom: 52 };
  const CW = PAGE.w - PAGE.m * 2;
  const T = pdfText;

  function render(doc, m, autoTable) {
    const text = (s, x, y, o) => doc.text(T(s), x, y, o);
    const color = (kind, c) => doc[kind === 'fill' ? 'setFillColor' : kind === 'draw' ? 'setDrawColor' : 'setTextColor'](...c);
    const newPage = () => { doc.addPage(); return PAGE.top; };
    const ensure = (y, need) => (y + need > PAGE.h - PAGE.bottom ? newPage() : y);
    const table = (opts) => { autoTable(doc, { margin: { left: PAGE.m, right: PAGE.m, top: PAGE.top, bottom: PAGE.bottom }, ...opts }); return doc.lastAutoTable.finalY; };

    doc.setProperties({ title: T(`PRIDE ${m.title}: ${m.teamMember}`), subject: 'PRIDE Training Log', author: 'PRIDE Training Log', creator: 'PRIDE Training Log' });

    // header band
    color('fill', COL.band); doc.rect(0, 0, PAGE.w, 92, 'F');
    color('fill', COL.goldHi); doc.rect(0, 92, PAGE.w, 2, 'F');
    doc.setFont('times', 'bold'); doc.setFontSize(32); color('text', COL.goldHi);
    text('PRIDE', PAGE.m, 56, { charSpace: 7 });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); color('text', [200, 192, 178]);
    text('TEAM MEMBER TRAINING LOG', PAGE.m, 72, { charSpace: 1.6 });
    doc.setFont('times', 'bold'); doc.setFontSize(17); color('text', [250, 246, 235]);
    text(m.title.toUpperCase(), PAGE.w - PAGE.m, 52, { align: 'right', charSpace: 1 });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); color('text', [200, 192, 178]);
    text('Pechanga Resort Casino  ·  Food & Beverage', PAGE.w - PAGE.m, 70, { align: 'right' });

    let y = 118;

    // details grid, two label/value pairs per row
    const d = m.details, pairs = [];
    for (let i = 0; i < d.length; i += 2) pairs.push([d[i], d[i + 1] || ['', '']]);
    y = table({
      startY: y, theme: 'plain', body: pairs.map(([a, b]) => [a[0].toUpperCase(), a[1], b[0].toUpperCase(), b[1]].map(T)),
      styles: { font: 'helvetica', fontSize: 9.5, cellPadding: { top: 4, bottom: 4, left: 0, right: 8 }, textColor: COL.ink, lineColor: COL.line, lineWidth: 0 },
      columnStyles: {
        0: { fontSize: 7.5, textColor: COL.muted, fontStyle: 'bold', cellWidth: 82 }, 1: { cellWidth: 176, fontStyle: 'bold' },
        2: { fontSize: 7.5, textColor: COL.muted, fontStyle: 'bold', cellWidth: 82 }, 3: { cellWidth: 176, fontStyle: 'bold' },
      },
    }) + 10;

    // alert for critical skills rated Improves
    if (m.flagged.length) {
      const msg = T(`Critical skills rated Improves: ${m.flagged.join(', ')}`);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
      const lines = doc.splitTextToSize(msg, CW - 28);
      const h = 16 + lines.length * 12;
      y = ensure(y, h + 10);
      color('fill', COL.dangerTint); color('draw', COL.danger); doc.setLineWidth(0.8);
      doc.roundedRect(PAGE.m, y, CW, h, 3, 3, 'FD');
      color('fill', COL.danger); doc.rect(PAGE.m, y, 4, h, 'F');
      color('text', COL.danger); doc.text(lines, PAGE.m + 16, y + 17);
      y += h + 16;
    }

    // `need` is the room the heading and the block right after it must share, so a heading is never
    // left alone at the bottom of a page
    const heading = (title, yy, need = 90) => {
      // breathing room above a heading, unless it starts a fresh page
      yy = yy + 12 + need > PAGE.h - PAGE.bottom ? newPage() : yy + 12;
      color('fill', COL.gold); doc.rect(PAGE.m, yy - 11, 3.5, 17, 'F');
      doc.setFont('times', 'bold'); doc.setFontSize(14.5); color('text', COL.ink);
      text(title, PAGE.m + 12, yy + 2);
      color('draw', COL.line); doc.setLineWidth(0.6); doc.line(PAGE.m, yy + 10, PAGE.w - PAGE.m, yy + 10);
      return yy + 24;
    };

    const paragraph = (str, yy, opts = {}) => {
      doc.setFont('helvetica', opts.italic ? 'italic' : 'normal'); doc.setFontSize(opts.size || 10); color('text', opts.color || COL.ink);
      const lines = doc.splitTextToSize(T(str), opts.width || CW);
      lines.forEach(line => { yy = ensure(yy, 14); doc.text(line, opts.x || PAGE.m, yy); yy += opts.lead || 13.5; });
      return yy;
    };

    // leader notes: a tinted block per note with a gold edge
    const notesBlock = (notes, yy, indent = 14) => {
      const x = PAGE.m + indent, w = CW - indent;
      notes.forEach(n => {
        const head = T(`${n.author}  ·  ${n.when}${n.about ? `  ·  on ${n.about}` : ''}`);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
        const body = n.text ? doc.splitTextToSize(T(n.text), w - 22) : [];
        const rl = n.ratingsText ? 1 : 0;
        const h = 14 + 12 + rl * 12 + body.length * 12 + 8;
        yy = ensure(yy, h + 6);
        color('fill', COL.tint); doc.rect(x, yy, w, h, 'F');
        color('fill', COL.gold); doc.rect(x, yy, 3, h, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); color('text', COL.gold);
        text('LEADER NOTE', x + 12, yy + 13, { charSpace: 0.8 });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); color('text', COL.muted);
        text(head, x + 12, yy + 25);
        let ty = yy + 38;
        if (rl) { doc.setFont('helvetica', 'bold'); doc.setFontSize(9); color('text', COL.gold); text(`Ratings: ${n.ratingsText}`, x + 12, ty); ty += 12; }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); color('text', COL.ink);
        body.forEach(line => { doc.text(line, x + 12, ty); ty += 12; });
        yy += h + 6;
      });
      return yy;
    };
    const sectionNotes = (key, yy) => {
      const list = m.sectionNotes[key] || [];
      return list.length ? notesBlock(list, yy) + 4 : yy;
    };

    // classes
    if (m.classes.length) {
      y = heading('Classes / Training Modules', y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
      m.classes.forEach((c, i) => {
        const col = i % 2, x = PAGE.m + col * (CW / 2);
        if (col === 0) y = ensure(y, 18);
        color('draw', c.completed ? COL.success : COL.muted); doc.setLineWidth(0.9); doc.rect(x, y - 8, 9, 9);
        if (c.completed) { color('draw', COL.success); doc.setLineWidth(1.4); doc.lines([[2.4, 2.6], [4.8, -6]], x + 1.8, y - 3.2); }
        color('text', COL.ink); doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
        text(doc.splitTextToSize(T(c.label), CW / 2 - 22)[0], x + 15, y);
        if (col === 1 || i === m.classes.length - 1) y += 16;
      });
      y += 4;
    }
    y = sectionNotes('classes', y) + 6;

    // soft skills
    const skillTable = (rows, startY) => {
      const body = [];
      rows.forEach(r => {
        body.push([
          { content: T(r.name + (r.critical ? '   [CRITICAL]' : '')), styles: { fontStyle: 'bold' } },
          { content: T(r.ratingLabel), styles: { fontStyle: 'bold', textColor: r.rating === 1 ? COL.danger : r.rating === 3 ? COL.success : COL.gold } },
          T(r.note),
        ]);
        r.notes.forEach(n => body.push([{ content: T(`Leader note · ${n.author} · ${n.when}\n${n.text}`), colSpan: 3,
          styles: { fillColor: COL.tint, textColor: COL.muted, fontStyle: 'italic', fontSize: 8.5, cellPadding: { top: 4, bottom: 4, left: 18, right: 8 } } }]));
      });
      return table({
        startY, head: [['SKILL', 'RATING', 'EVALUATOR NOTE']], body, theme: 'grid',
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: COL.ink, lineColor: COL.line, lineWidth: 0.5, valign: 'middle' },
        headStyles: { fillColor: COL.band, textColor: COL.goldHi, fontSize: 7.5, fontStyle: 'bold', lineWidth: 0 },
        columnStyles: { 0: { cellWidth: 200 }, 1: { cellWidth: 70 }, 2: { cellWidth: 'auto' } },
      });
    };
    if (m.skills.all.length || m.skills.leadership.length || (m.sectionNotes.soft_skills || []).length) {
      y = heading('Soft Skills', y);
      if (m.skills.all.length) y = skillTable(m.skills.all, y) + 22;
      if (m.skills.leadership.length) {
        y = ensure(y, 50);
        doc.setFont('times', 'bold'); doc.setFontSize(12); color('text', COL.gold); text('Leadership Focus', PAGE.m, y);
        y = skillTable(m.skills.leadership, y + 8) + 10;
      }
      y = sectionNotes('soft_skills', y) + 6;
    }

    // competencies
    if (m.competencies.length) {
      y = heading('Competency Ratings', y, 110);
      y = ensure(y, 70);
      const bw = (CW - 20) / 3;
      m.competencies.forEach((c, i) => {
        const x = PAGE.m + i * (bw + 10);
        color('fill', COL.tint); color('draw', COL.line); doc.setLineWidth(0.6); doc.roundedRect(x, y, bw, 58, 4, 4, 'FD');
        doc.setFont('times', 'bold'); doc.setFontSize(26); color('text', COL.gold);
        text(c.rating ? String(c.rating) : '—', x + bw / 2, y + 28, { align: 'center' });
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); color('text', COL.ink);
        text(c.name.toUpperCase(), x + bw / 2, y + 41, { align: 'center', charSpace: 0.8 });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); color('text', COL.muted);
        text(c.label, x + bw / 2, y + 52, { align: 'center' });
      });
      y += 72;
    }
    y = sectionNotes('competencies', y) + 6;

    // written sections
    const written = (title, key, parts) => {
      const filled = parts.filter(p => p.text);
      if (!filled.length && !(m.sectionNotes[key] || []).length) return;
      y = heading(title, y);
      filled.forEach(p => {
        if (p.label) { y = ensure(y, 28); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); color('text', COL.gold); text(p.label.toUpperCase(), PAGE.m, y, { charSpace: 0.8 }); y += 12; }
        y = paragraph(p.text, y) + 6;
      });
      y = sectionNotes(key, y) + 6;
    };
    written('Policies Reviewed', 'policies', [{ text: m.texts.policies }]);
    written('Expectations for Next Period', 'expectations', [{ text: m.texts.expectations }]);
    written('Trainer Observations', 'observations', [
      { label: 'Strengths & highlights', text: m.texts.strengths },
      { label: 'Areas for improvement', text: m.texts.improvements },
      { label: 'Trainer observation notes', text: m.texts.trainerNotes },
    ]);

    // signatures
    const sigH = 112;
    y = heading('Signatures', y, sigH + 36);
    const bw = (CW - 24) / 2;
    m.signatures.forEach((s, i) => {
      const x = PAGE.m + i * (bw + 24);
      if (s.image) {
        const p = doc.getImageProperties(s.image);
        const k = Math.min((bw - 8) / p.width, 58 / p.height);
        doc.addImage(s.image, 'PNG', x + 4, y + 62 - p.height * k, p.width * k, p.height * k, undefined, 'FAST');
      } else if (s.text) {
        doc.setFont('times', 'italic'); doc.setFontSize(18); color('text', COL.ink); text(s.text, x + 4, y + 52);
      }
      color('draw', COL.ink); doc.setLineWidth(0.8); doc.line(x, y + 66, x + bw, y + 66);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); color('text', COL.ink); text(s.name, x, y + 79);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); color('text', COL.muted);
      text(s.role.toUpperCase(), x, y + 90, { charSpace: 0.6 });
      text(s.image ? `Signed ${s.signedAt || ''}` : s.text ? 'Typed signature (older evaluation)' : 'Not signed', x, y + 101);
    });
    y += sigH;
    if (m.manager) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); color('text', COL.muted);
      text(`Manager / Supervisor: ${m.manager}`, PAGE.m, y); y += 14;
    }
    y = sectionNotes('signatures', y) + 6;
    y = sectionNotes('info', y);

    // general notes
    if ((m.sectionNotes.general || []).length) {
      y = heading('General Notes', y + 4);
      notesBlock(m.sectionNotes.general, y, 0);
    }

    // running header (pages 2+) and footer (all pages)
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      if (i > 1) {
        doc.setFont('times', 'bold'); doc.setFontSize(10); color('text', COL.gold); text('PRIDE', PAGE.m, 30, { charSpace: 3 });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); color('text', COL.muted);
        text(`${m.teamMember}  ·  ${m.title}`, PAGE.w - PAGE.m, 30, { align: 'right' });
        color('draw', COL.line); doc.setLineWidth(0.5); doc.line(PAGE.m, 38, PAGE.w - PAGE.m, 38);
      }
      color('draw', COL.line); doc.setLineWidth(0.5); doc.line(PAGE.m, PAGE.h - 40, PAGE.w - PAGE.m, PAGE.h - 40);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); color('text', COL.muted);
      text('PRIDE Training Log  ·  Confidential  ·  For internal use', PAGE.m, PAGE.h - 27);
      text(`Generated ${m.generatedAt}   ·   Page ${i} of ${pages}`, PAGE.w - PAGE.m, PAGE.h - 27, { align: 'right' });
    }
    return doc;
  }

  // ── browser: load the libraries on first use, render, save ───────────
  function loadScript({ src, integrity }) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.integrity = integrity; s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the PDF library. Check your connection and try again.'));
      document.head.appendChild(s);
    });
  }
  async function loadLibs() {
    if (!(window.jspdf && window.jspdf.jsPDF)) await loadScript(LIBS.jspdf);
    if (!(window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable)) await loadScript(LIBS.autotable);
  }
  async function download(e, notes) {
    await loadLibs();
    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true });
    const at = (d, opts) => (typeof d.autoTable === 'function' ? d.autoTable(opts) : window.jspdf.autoTable(d, opts));
    const m = model(e, notes);
    render(doc, m, at);
    doc.save(m.fileName);
    return m.fileName;
  }

  return { pdfText, fmtDate, fmtDateTime, fileName, model, render, download };
})();

if (typeof module !== 'undefined') module.exports = PridePdf;
