# Film Club feeds: sharing personal awards

A small, optional extension to the `film-club/1` feed body (and to the v2 sync
snapshot records, which carry the same movie shape). Cinema Roll publishes and
reads it as of 2026-10-07. Nothing here is required: a feed without these fields
is read exactly as before, and a reader that does not know them ignores them.

## 1. The ceremony's name, once

Top level of the legacy body, and `meta.profile` is unaffected:

```json
{ "format": "film-club/1", "name": "Brian", "awardsName": "Gogan Globes", "movies": [ ... ] }
```

`awardsName`: string, 1–80 characters. The name the publisher gives their own
awards. Shown as the heading over their awards on a movie page.

## 2. Per movie, the awards it received

On a movie record (legacy body `movies[]` and v2 `movies/<tmdbId>` alike):

```json
{
  "tmdbId": 550,
  "title": "Fight Club",
  "rating": 8.25,
  "awards": [
    { "year": 2015, "category": "bestPicture",  "label": "Best Picture",  "result": "won" },
    { "year": 2015, "category": "bestDirector", "label": "Best Director", "result": "nominated", "name": "David Fincher" },
    { "year": 2016, "category": "needleDrop",   "label": "Best Needle Drop", "result": "won" }
  ]
}
```

| Field | Contract |
| --- | --- |
| `year` | Integer. The awards year (the ceremony's year, however the publisher counts it). |
| `category` | String, 1–60 chars. The publisher's own stable key for the category. Opaque to readers; used only to tell categories apart. |
| `label` | String, 1–120 chars. Human-readable category name, as the reader should display it. Custom categories are fine. |
| `result` | Exactly `"won"` or `"nominated"`. A film that won is listed as `won` only, not also as `nominated`. |
| `name` | Optional string, 1–120 chars. For a person award (Best Director, Best Actress, an honorary award): the person, attached to the film they were recognised for. |

Omit `awards` entirely when a movie has none. Keep the list short — it is per
film, typically one to three entries. Order is free; readers sort by year.

## 3. Semantics

- Awards are published under the same switch as ratings: anyone who may read
  the feed may read the awards. (If you'd rather gate them separately, just omit
  the fields when the switch is off.)
- An awards edit is a change to that movie's record. In v2 it is an ordinary
  upsert in the journal; the legacy revision moves as for any body change.
- A reader shows them on the movie's page beside its own awards, under
  `awardsName` with the publisher's display name, wins first. Cinema Roll's
  folded summary reads e.g. `Gogan Globes (Brian): Best Picture`.
- Readers validate: drop any entry missing `year`/`category`/`label`, with a
  `result` other than the two values, or over the length limits.

## 4. What Cinema Roll publishes

Everything above, derived from each user's personal awards (`personalAwards`
tree): standard and custom categories, wins and nominations, with `name` for
person categories. `awardsName` is the user's own ceremony name (e.g. "The
Groskers").

## 5. What Movie Log would add

For each movie record in the feed and in the v2 snapshot/journal: an `awards`
list as in §2, built from that user's Gogan Globes (or whatever they call
theirs); at the top of the legacy body, `awardsName`. That is the whole change.
