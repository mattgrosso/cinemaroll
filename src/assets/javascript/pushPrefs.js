// Push notification preferences — the shared shape the settings UI, the
// store, and the push Lambda all agree on. Stored at `{topKey}/push/prefs`.
//
// Category toggles mirror the four notification sources Matt named
// (2026-08-27): the three home-screen prompts, plus friend logs.
//
// CADENCE (Matt, 2026-08-28: "It'll be nice if it just happened more
// regularly, you know, as the prompts come in"):
//   'asTheyCome' — the default. The Lambda sweeps every 15 minutes and pings
//     when something NEW is waiting, inside the waking window, spaced by
//     `pushesPerDay`. It deliberately does NOT re-announce a backlog it has
//     already mentioned — see aws-lambda/pushCadence.js, which owns every
//     one of those rules and is where the tests live.
//   'daily' — the original behaviour, one nudge at `hour`.
//
// `tz` places all of it in local time, so a trip abroad doesn't shift the
// nudges to 3am — as long as the app is opened there once to re-save it.

export const PUSH_PREF_DEFAULTS = {
  enabled: true,
  stickiness: true,
  tiebreak: true,
  awards: true,
  friendLogs: true,
  // Whether a friend-log push says what they rated it. Matt, 2026-09-06:
  // "you should have the option in your notifications to turn off the score
  // so you see that they watched it, but you don't see their score." The
  // READER's choice; whether a score travels at all is still the rater's
  // sharing tier (RateMovie sends null when ratings aren't shared).
  friendLogScores: true,
  // A once-a-day reminder to play the games. OFF by default — Matt,
  // 2026-09-07: "an optional notification, one that defaults to off, but
  // you can turn it on, that reminds you to play the games every day, maybe
  // even you can choose per game." Only the games not yet played that day
  // are named; a day with every game played sends nothing. `gamePicks`
  // holds the per-game choice as `{ [gameKey]: false }` for a game muted
  // from the reminder — absent means ON, so a game added later joins the
  // reminder without anyone touching a switch (and an empty map, which
  // Firebase would drop anyway, means "all of them"). See gameReminderOn.
  games: false,
  // Films still waiting on the Showtimes screen add to the icon badge. OFF
  // by default - Matt, 2026-10-05: "it should be possible to turn that off
  // under notifications ... and it should be off by default."
  showtimes: false,
  // Evening, like the daily cadence: games are a wind-down thing.
  gamesHour: 20,
  cadence: 'asTheyCome',
  // Waking hours. Anything maturing overnight waits for the morning.
  windowStart: 9,
  windowEnd: 21,
  // Spread across the window, so 4 across 9am–9pm is one every three hours —
  // a ceiling, not a target: with nothing new to say, nothing is sent.
  pushesPerDay: 4,
  // Only used by the 'daily' cadence. 7pm local: these are sit-down-with-the-
  // app tasks, and evening is when movies happen.
  hour: 19
};

// Whether one game is part of the reminder. Mirrored in
// aws-lambda/pushCadence.js (gamesDue) — the Lambda reads prefs directly.
export function gameReminderOn (prefs, gameKey) {
  return prefs?.gamePicks?.[gameKey] !== false;
}

export function pushPrefsWithDefaults (stored) {
  return {
    ...PUSH_PREF_DEFAULTS,
    tz: (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'America/New_York',
    ...(stored || {})
  };
}
