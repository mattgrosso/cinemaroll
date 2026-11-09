// Which theaters the Showtimes screen draws (Matt, 2026-11-09: "doesn't need
// to show all of theaters that have zero entries … the screen can be empty
// when it's nothing to show … caught up"). A theater gets a section only when
// it has a card under the current toggles; one whose board couldn't be read
// is named in a single line at the bottom instead, so a broken scraper never
// passes for "caught up".
export function boardSections (theaters) {
  const list = Array.isArray(theaters) ? theaters : [];
  const visible = list.filter((t) => (t.shown || []).length > 0);
  const unreadable = list.filter((t) => !t.ok && !(t.shown || []).length).map((t) => t.name);
  return { visible, unreadable, caughtUp: visible.length === 0 };
}

// "the Charles", "the Charles and AMC", "the Charles, AMC and the Senator".
export function nameList (names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
