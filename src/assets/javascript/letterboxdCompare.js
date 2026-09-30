// Your numbers against Letterboxd's (2026-09-29). Pure and store-free.
//
// `films` is the shared letterboxdFilms map (tmdbId -> { rating, ratingCount,
// fans, ... }) the sweep fills; `entries` are library entries. The two scales
// can't be subtracted — a Cinema Roll score is a weighted 0–10 normalised
// across the library, a Letterboxd rating is a 0.5–5 star average of a
// crowd — so every comparison here is by RANK within the films both sides
// have rated. Matt: "how do my ratings differ from Letterboxd ratings?"

export const crowdFilm = (films, tmdbId) => {
  const film = films?.[tmdbId];
  return film && !film.missing ? film : null;
};

export const crowdRating = (films, tmdbId) => {
  const film = crowdFilm(films, tmdbId);
  return Number.isFinite(film?.rating) ? film.rating : null;
};

export const crowdCount = (films, tmdbId) => {
  const film = crowdFilm(films, tmdbId);
  return Number.isFinite(film?.ratingCount) ? film.ratingCount : null;
};

// Fans per thousand ratings — a cult film has a small crowd that adores it.
export const cultRatio = (film) => {
  if (!film || !Number.isFinite(film.fans) || !Number.isFinite(film.ratingCount) || film.ratingCount <= 0) return null;
  return (film.fans / film.ratingCount) * 1000;
};

// Average ranks, ties shared, 0..n-1.
const ranks = (values) => {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1;
    const shared = (i + j) / 2;
    for (let k = i; k <= j; k += 1) result[order[k].index] = shared;
    i = j + 1;
  }
  return result;
};

const pearson = (xs, ys) => {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (!sxx || !syy) return null;
  return sxy / Math.sqrt(sxx * syy);
};

export const agreementLabel = (rho) => {
  if (!Number.isFinite(rho)) return null;
  if (rho >= 0.7) return 'in step';
  if (rho >= 0.45) return 'mostly in step';
  if (rho >= 0.2) return 'loosely related';
  if (rho > -0.2) return 'on separate paths';
  return 'at odds';
};

// Every film both sides rated, with each side's percentile within that set.
// `gap` is yours minus theirs: positive means you rank it higher than the
// crowd does. Placeholders and films Letterboxd doesn't know drop out.
export function crowdRows (entries, getRatingFn, films) {
  const rows = [];
  for (const entry of entries || []) {
    const tmdbId = entry?.movie?.id;
    const crowd = crowdRating(films, tmdbId);
    const mine = getRatingFn(entry)?.calculatedTotal;
    if (crowd === null || !Number.isFinite(mine)) continue;
    rows.push({ entry, tmdbId, mine, crowd, count: crowdCount(films, tmdbId) });
  }
  if (rows.length < 2) return rows;
  const myRanks = ranks(rows.map((row) => row.mine));
  const crowdRanks = ranks(rows.map((row) => row.crowd));
  const top = rows.length - 1;
  rows.forEach((row, index) => {
    row.myRank = myRanks[index];
    row.crowdRank = crowdRanks[index];
    row.myPct = myRanks[index] / top;
    row.crowdPct = crowdRanks[index] / top;
    row.gap = row.myPct - row.crowdPct;
  });
  return rows;
}

// The Ratings-tab section: one correlation, then the films you rank far
// above the crowd and the ones it ranks far above you.
export function tasteVsCrowd (entries, getRatingFn, films, { minCount = 20, cap = 8 } = {}) {
  const rows = crowdRows(entries, getRatingFn, films);
  if (rows.length < minCount) return { count: rows.length, ready: false };
  const rho = pearson(rows.map((row) => row.myRank), rows.map((row) => row.crowdRank));
  const byGap = [...rows].sort((a, b) => b.gap - a.gap);
  return {
    count: rows.length,
    ready: true,
    spearman: rho,
    label: agreementLabel(rho),
    youLove: byGap.filter((row) => row.gap > 0).slice(0, cap),
    crowdLoves: byGap.filter((row) => row.gap < 0).reverse().slice(0, cap)
  };
}

// The Home sort: the crowd's rating, unknown films last.
export const crowdSortValue = (item, films) => crowdRating(films, item?.movie?.id) ?? -1;

// Chip sets for Home. "Crowd loves" is the top of the crowd's own scale;
// "you disagree" is the widest gaps either way, by rank.
export function crowdLovesList (entries, films, { minRating = 4.0, minCount = 1000 } = {}) {
  return (entries || []).filter((entry) => {
    const film = crowdFilm(films, entry?.movie?.id);
    return Number.isFinite(film?.rating) && film.rating >= minRating && (film.ratingCount ?? 0) >= minCount;
  });
}

export function disagreeList (entries, getRatingFn, films, { minGap = 0.4 } = {}) {
  return crowdRows(entries, getRatingFn, films)
    .filter((row) => Math.abs(row.gap) >= minGap)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    .map((row) => row.entry);
}

export function cultList (entries, films, { minRatio = 40, minCount = 500, cap = Infinity } = {}) {
  return (entries || [])
    .map((entry) => ({ entry, ratio: cultRatio(crowdFilm(films, entry?.movie?.id)), count: crowdCount(films, entry?.movie?.id) }))
    .filter(({ ratio, count }) => ratio !== null && ratio >= minRatio && (count ?? 0) >= minCount)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, cap)
    .map(({ entry }) => entry);
}

// "★ 4.03 · 4.1M" for a row; null when the crowd hasn't spoken.
export function crowdLine (films, tmdbId, compact) {
  const film = crowdFilm(films, tmdbId);
  if (!Number.isFinite(film?.rating)) return null;
  const count = Number.isFinite(film.ratingCount) && compact ? compact(film.ratingCount) : null;
  return count ? `★ ${film.rating.toFixed(2)} · ${count}` : `★ ${film.rating.toFixed(2)}`;
}
