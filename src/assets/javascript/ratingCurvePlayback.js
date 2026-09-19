// Replaying the ratings curve.
//
// Bug report -P1mlsyZlwk2RTeYxOit (2026-09-18): "I would like to be able to
// animate the ratings curve graph. I want to hit play and see an animation of
// all of my ratings in the order I rated them being added to the graph,
// eventually arriving at my current curve."
//
// Two halves of that sentence pull against each other, and getting both is
// the whole design problem here.
//
// "All of my ratings, in the order I rated them" means every rating EVENT,
// including the second and third time a film was rated. "Eventually arriving
// at my current curve" means the last frame has to be, exactly, what the
// static chart shows — and that chart counts each FILM once, at its most
// recent rating. Simply dropping every rating into a bucket as it happens
// gives a final frame with re-rated films counted twice, which is a different
// chart wearing the same axes.
//
// So a film doesn't accumulate, it MOVES. Each rating event places its film
// in a bucket and takes it out of whichever bucket it was in before. A first
// rating is a film joining the curve; a re-rating is a film sliding along it.
// Every rating gets its moment, and the last frame is the current curve by
// construction, not by coincidence.
//
// Pure and store-free: Insights.vue hands in the already-computed ratings.

// The buckets the static chart draws, whatever the library happens to
// contain. Playback shows the same axis from the first frame so the bars
// grow in place instead of the chart reshaping under them.
export const STANDARD_BUCKETS = [
  1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10
];

/** The half-point bucket a score falls in — the static chart's own rounding. */
export function bucketFor (total) {
  const value = Math.round(parseFloat(total) * 2) / 2;
  return Number.isFinite(value) ? value : 0;
}

/**
 * When a rating happened, as a number. An unparseable or missing date sorts
 * to the very beginning rather than being dropped: we don't know WHEN it was
 * rated, but we do know the film is in the library, and losing it would make
 * the last frame disagree with the chart it's supposed to land on. Those
 * films are simply already there when the animation starts.
 */
export function ratedAt (rating) {
  const date = rating?.date;
  // `new Date(null)` is the epoch, not an error — a null date would otherwise
  // sort as 1 January 1970 rather than as "don't know".
  if (date === null || date === undefined || date === '') return -Infinity;
  const time = new Date(date).getTime();
  return Number.isFinite(time) ? time : -Infinity;
}

/**
 * Every rating in the library, oldest first, as { filmId, at, bucket }.
 *
 * `entries` are library entries; `allRatingsFor` is GetRating's
 * `getAllRatings`, passed in so this file never imports the store. Films with
 * no usable rating are skipped, exactly as the static chart skips them.
 *
 * Ties (two ratings on the same day, or two undated ones) keep library order,
 * which is stable — the frame they land in is the same either way.
 */
export function ratingEvents (entries, allRatingsFor) {
  const events = [];

  (entries || []).forEach((entry, index) => {
    const ratings = allRatingsFor(entry) || [];
    ratings.forEach((rating) => {
      if (!rating || !rating.calculatedTotal) return;
      events.push({ filmId: index, at: ratedAt(rating), bucket: bucketFor(rating.calculatedTotal) });
    });
  });

  return events
    .map((event, order) => ({ event, order }))
    .sort((a, b) => a.event.at - b.event.at || a.order - b.order)
    .map((wrapped) => wrapped.event);
}

/** Every bucket the axis needs: the standard ones plus anything unusual. */
export function bucketsFor (events) {
  const all = new Set(STANDARD_BUCKETS);
  (events || []).forEach((event) => all.add(event.bucket));
  return [...all].sort((a, b) => a - b);
}

/**
 * The frames to draw, evenly spaced through the events.
 *
 * Frames are sliced by COUNT OF RATINGS, not by elapsed time. A library is
 * lumpy — a burst of forty films over one holiday, then nothing for a month —
 * and a time-sliced replay spends most of its run watching an empty chart and
 * then flickers through the interesting part. Even slices mean the bars move
 * at a steady rate, which is the thing worth watching.
 *
 * Each frame carries the date it has reached so the caption can say where in
 * the history you are; the lumpiness shows up there, where it reads as
 * information rather than as a stalled animation.
 */
export function playbackFrames (events, { frameCount = 60 } = {}) {
  const list = events || [];
  const buckets = bucketsFor(list);
  const indexOf = new Map(buckets.map((bucket, index) => [bucket, index]));

  const counts = new Array(buckets.length).fill(0);
  const placed = new Map(); // filmId -> the bucket index it currently sits in
  const frames = [];

  // At least one frame per event is pointless past the frame budget, and
  // fewer frames than events is the normal case for a real library.
  const steps = Math.max(1, Math.min(frameCount, list.length));
  let cursor = 0;

  for (let step = 1; step <= steps; step += 1) {
    const upTo = Math.round((step / steps) * list.length);

    while (cursor < upTo) {
      const event = list[cursor];
      const to = indexOf.get(event.bucket);
      const from = placed.get(event.filmId);
      if (from !== undefined) counts[from] -= 1;
      counts[to] += 1;
      placed.set(event.filmId, to);
      cursor += 1;
    }

    const last = list[cursor - 1];
    frames.push({
      counts: [...counts],
      // Films on the chart, not ratings made — it's what the bars add up to.
      films: placed.size,
      ratings: cursor,
      // -Infinity means every rating so far is undated; there's no date to show.
      at: last && Number.isFinite(last.at) ? last.at : null
    });
  }

  return { buckets, frames };
}
