// Names → TMDB person ids and genders, kept across visits.
//
// The library stores cast and crew by NAME only (storedEntry.js trims the
// ids), so every screen that wants a person's filmography or gender first
// asks TMDB /search/person for the name. The Watchlist did that for its
// eight favourite performers on every open — the same eight names, the
// same eight answers — which Sentry flagged as an N+1 (2026-10-08). A name
// resolves to the same person next week, so the answer is worth keeping.
//
// localStorage, not the database: it is a per-device convenience, nothing
// is lost if it vanishes, and it must never cost a write. Capped and aged
// so a long-lived browser doesn't carry every name it ever searched.
//
// The awards picker (2026-10-15) asked the same /search/person question for
// every cast member of a year's films, kept the answers only 24 hours and
// per awards year, and Sentry named it an N+1 on PersonalAwardsScreen. It
// reads this cache now, which is why an entry also keeps the photo and the
// cap is sized for a few years of casts (~80 bytes a name).
const KEY = 'cinemaRoll.people.ids';
const MAX_ENTRIES = 2000;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

let memory = null;

function load () {
  if (memory) return memory;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || 'null');
    memory = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    memory = {};
  }
  return memory;
}

function save () {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // Full or unavailable: the in-memory copy still saves this visit's repeats.
  }
}

/**
 * `{ id, gender }` for a name looked up recently, else null — plus
 * `profile_path` (a path or null) when the photo was kept. An entry written
 * before photos were kept has no `profile_path` at all; a caller that needs
 * the photo treats that as a miss.
 */
export function rememberedPerson (name, now = Date.now()) {
  if (!name) return null;
  const entry = load()[name];
  if (!entry || entry.id == null || now - (entry.at || 0) > MAX_AGE_MS) return null;
  const person = { id: entry.id, gender: entry.gender ?? 0 };
  if (entry.photo !== undefined) person.profile_path = entry.photo;
  return person;
}

/** Keep what TMDB said a name is. Misses are not kept: they are retried next visit. */
export function rememberPerson (name, match, now = Date.now()) {
  if (!name || match?.id == null) return;
  const entries = load();
  entries[name] = { id: match.id, gender: match.gender ?? 0, photo: match.profile_path ?? null, at: now };
  const names = Object.keys(entries);
  if (names.length > MAX_ENTRIES) {
    names
      .sort((a, b) => (entries[a].at || 0) - (entries[b].at || 0))
      .slice(0, names.length - MAX_ENTRIES)
      .forEach((stale) => { delete entries[stale]; });
  }
  save();
}

/** Tests, and nothing else: the cache would otherwise leak between cases. */
export function forgetPeople () {
  // null, not {}: the next read reloads localStorage, so a test can seed it.
  memory = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}
