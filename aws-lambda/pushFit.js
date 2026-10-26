// Every notification has to fit Matt's Apple Watch (2026-10-26, "They need to
// fit on my watch"): a title of at most 24 characters and a body of at most
// 60. The wording in pushCadence.js / newsletterCompose.js is written to fit
// the usual case; this is the backstop for a long film title or name. Both
// senders' buildPayload run every notification through fitNotification.
// Tested from src/test/pushFit.test.js.

const TITLE_MAX = 24;
const BODY_MAX = 60;

/**
 * Collapse whitespace; anything longer than `max` is cut at a word (if one
 * ends past halfway), trailing punctuation dropped, and "…" added.
 */
function clip (text, max) {
  const clean = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  const kept = space > max / 2 ? cut.slice(0, space) : cut;
  return `${kept.replace(/[\s,.;:–—-]+$/, '')}…`;
}

function fitNotification ({ title, body }) {
  return { title: clip(title, TITLE_MAX), body: clip(body, BODY_MAX) };
}

module.exports = { TITLE_MAX, BODY_MAX, clip, fitNotification };
