# Film Club feeds: sharing personal awards

> **The shared contract now lives in `mattgrosso/film-club`** (`~/code/film-club`, since
> 2026-10-08): `SPEC.md` is authoritative, and anything that changes what Cinema Roll and
> Movie Log exchange goes through a proposal there (`PROCESS.md`), never straight into
> either app. This file is kept as history.

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

## 6. What Movie Log actually sends (2026-10-07)

Movie Log shipped `awards` without `awardsName`, and with the ceremony folded
into every label: `"label": "Goegan Globes: Best Picture"`, `category` an
opaque `institution-…` key, several `won` entries per category where several
people share an award (three editors, say). Cinema Roll reads this as is: when
a profile has no `awardsName` and all of its labels share one `Name: ` prefix,
that prefix becomes the ceremony and is peeled off the labels
(`friendCeremony` / `stripCeremony` in `src/assets/javascript/awardsShare.js`).
Sending `awardsName` is still welcome and takes precedence, but nothing on the
Movie Log side needs to change.

## 6a. Where the ceremony name goes (2026-10-08)

Knox's awards were showing on Cinema Roll as "Knox's awards", not the Ollies:
his labels carry no "Ollies: " prefix, and the v2 header had nowhere to put a
name. Movie Log reads the v2 sync feed, so that is where the name now lives,
in both directions:

- **v2 header:** `meta.profile.awardsName`, beside `name` and `source`. A
  string, 1–80 characters, optional. Example: `"profile": { "name": "Knox",
  "source": "movielog", "awardsName": "The Ollies" }`. Cinema Roll publishes
  its users' ceremony there ("The Groskers") and reads friends' from there.
- **Legacy body:** `awardsName` at the top level, as in §1.
- **Revision:** a ceremony rename has to move the feed's `revision`, or a
  reader that skips unchanged feeds never sees it. Cinema Roll's revision
  covers `awardsName` whenever the feed has one.

Without a name, Cinema Roll still falls back to a label prefix, now one that
more than half of the labels share (it used to need every label).

## 6b. What Movie Log actually sends (2026-10-09)

Movie Log now sends `awardsName`, but only at the top of the legacy body, not
in `meta.profile`; Knox's is "The Ollie’s", Brian's "Personal awards" (the
default for a user who never named theirs). Cinema Roll's v2 reader now also
reads the legacy `awardsName` beside meta and revision on every refresh, uses
it when the header has none, and treats a changed name as an update even when
the revision did not move. "Personal awards" (and "Awards", "My awards")
counts as no name, so Brian's ceremony still comes from his label prefix.
The cleaner fix on Movie Log's side is still §6a: put the name in
`meta.profile.awardsName`, cover it in the revision, and omit it when the user
has not named their awards.

## 7. Best International Feature (2026-10-07)

Cinema Roll's standard categories gained **Best International Feature**: films
with at least one TMDB production country and none of them the US (a British
film qualifies; a US co-production does not). Cinema Roll publishes it like any
other category (`category: "bestInternationalFeature"`, `label: "Best
International Feature"`). Movie Log's existing "Best Foreign Film" already
lines up with it in the club view — readers match categories by name, and
"Foreign Film", "Foreign Language Film", "International Feature" and
"International Feature Film" all fold together — so nothing on the Movie Log
side needs to change. If Movie Log ever offers default categories to new
users, this is the one Cinema Roll would suggest including.
