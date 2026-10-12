// Pure helpers for cloud drafts. The Firestore calls and the UI live in index.html.
const PrideDrafts = (() => {
  // A stored payload is the form snapshot as JSON. Returns the snapshot, or null when the
  // text is not a usable draft (a damaged or hand-edited document must not break the form)
  function decode(text) {
    let snapshot;
    try { snapshot = JSON.parse(text); } catch(e) { return null; }
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.vals || typeof snapshot.vals !== 'object') return null;
    return snapshot;
  }

  // A draft that was just saved has no server timestamp yet; treat it as the newest
  function millis(d) {
    return d.updatedAt && typeof d.updatedAt.toMillis === 'function' ? d.updatedAt.toMillis() : Date.now();
  }

  function sortNewestFirst(list) {
    return list.slice().sort((a, b) => millis(b) - millis(a));
  }

  function title(d) {
    return (d.tmName || '').trim() || 'Untitled draft';
  }

  function savedLabel(d) {
    return new Date(millis(d)).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  return { decode, sortNewestFirst, title, savedLabel };
})();

if (typeof module !== 'undefined') module.exports = PrideDrafts;
