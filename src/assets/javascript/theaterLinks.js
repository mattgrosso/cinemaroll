// Where a Showtimes link goes. Most theaters: the film's page on the
// theater's own site, in a new tab. Alamo: the Alamo iPhone app, with
// nothing attached (Matt, 2026-09-29: "can we just open the Alamo app
// directly without any parameters? … I'll find the movie myself").
//
// No web link can open that app: its apple-app-site-association claims only
// the Season Pass sign-up paths, it publishes no URL scheme, and the App
// Store won't install it on a Mac, so its Info.plist can't be read. So the
// link runs a one-step Shortcut on Matt's phone, "Open Alamo" (a single
// "Open App: Alamo Drafthouse" action). Shortcuts flashes on screen first.
export const ALAMO_SHORTCUT = 'Open Alamo';
export const ALAMO_APP_LINK = `shortcuts://run-shortcut?name=${encodeURIComponent(ALAMO_SHORTCUT)}`;

export const isAlamo = (theaterKey) => typeof theaterKey === 'string' && theaterKey.startsWith('alamo-');

/** The href for a theater heading (item omitted) or one of its films. */
export function theaterHref (theater, item = null) {
  if (!theater) return null;
  if (isAlamo(theater.key)) return ALAMO_APP_LINK;
  return (item && item.url) || theater.url || null;
}

/** Web pages open in a new tab; an app link must not (it would leave a blank one behind). */
export const opensInNewTab = (href) => typeof href === 'string' && /^https?:/i.test(href);
