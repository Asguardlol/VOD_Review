# WoW VOD Review

A multi-POV raid VOD review tool. Load several players' recordings of the same
pull, sync them to one shared timeline, and scrub through them together to work
out what went wrong.

## Why

Existing tools cap at four POVs and only support Twitch. This one:

- **Groups POVs by guild/team**, so a review can hold a whole raid's worth of
  angles and stay browsable — you pick a group, then choose which POVs to watch.
- **Supports YouTube and Twitch**, mixable in the same review.

## How syncing works

Each POV stores an `offsetMs`: how far into *that* video the shared timeline's
zero point falls. Seeking the timeline to `t` seeks POV `p` to `t + p.offsetMs`.

You set it with the **Sync here** control — scrub a POV to a recognizable moment
(pull start, a specific cast) and pin it.

Neither platform seeks frame-accurately, so a background tick continuously
measures each player against a reference and corrects drift: small drift is
absorbed by briefly changing playback rate where supported, larger drift by
re-seeking. If any POV starts buffering, all of them are held — otherwise the
others run ahead and the angles stop being comparable.

## Known platform limits

These are real constraints, not missing features:

- **Twitch clips cannot be synced.** The clip embed has no `seek()` or
  `getCurrentTime()`, so a clip can't be driven from a shared timeline. Use the
  full VOD instead.
- **Twitch VODs expire** after ~14 days (~60 for Partners/Turbo). Only
  *highlights* are permanent, so save a highlight if a review needs to last.
- **Some YouTube videos refuse to embed** — embedding disabled by the uploader,
  or age-restricted. The app detects this and says so rather than showing a
  black box.
- **Twitch has no playback-rate control**, so speed adjustment is only available
  when every POV in a review is YouTube.

## Watching several angles at once

One stream is the default. The sidebar lists every POV grouped by guild/team;
checking a POV adds it to the grid, clicking its name solos it. Up to **four**
can play together — 1 fills the area, 2 sit side by side, 3–4 tile 2×2.

Exactly one POV is audible at a time (the 🔊 button). The rest are muted, which
is both what makes many streams bearable and what lets them all start together —
browsers exempt muted playback from the autoplay gesture requirement.

## Warcraft Logs

Attaching a pull from a Warcraft Logs report bounds the timeline by the fight
instead of by the longest VOD, makes timeline zero mean *pull start*, and draws
**death lines** on the scrub bar in class colours. Clicking one jumps to five
seconds before the death — the useful question is what killed them.

You sign in with your own Warcraft Logs account, using OAuth authorization code
+ **PKCE**. No token to paste, no secret anywhere — PKCE exists precisely for
clients that cannot hold one, which is the situation any static site is in.
Signing in as yourself is also what makes **private and guild reports** work.

Register the client at warcraftlogs.com/api/clients with **"Public Client"**
ticked, and set `VITE_WCL_CLIENT_ID`. See `.env.example`.

Everything else in the app works with Warcraft Logs unconfigured.

## Twitch

Streams are identified by channel name, not by video: the app finds whichever
VOD covers the report's time range. That needs a Twitch app Client ID
(`VITE_TWITCH_CLIENT_ID`) and uses the implicit grant flow — again no secret.

Neither Client ID is sensitive. Both appear in the authorize URL every user is
sent to, and both are inlined into the built JavaScript regardless.

## Storage and sharing

There is no server. This is a static site.

- Reviews are stored in **IndexedDB**, in one browser profile. Clearing site
  data deletes them and they don't follow you to another machine.
- **Share** copies a link with the whole review compressed into the URL
  fragment. A review is mostly video ids and offsets, so it stays small — but
  very large reviews are offered as a JSON download instead, because some chat
  clients truncate long links.
- **Download JSON** / **Import JSON** moves a review between browsers.

Persistence sits behind a `ReviewStore` interface, so a real backend can be
added later as another implementation rather than a rewrite.

## Development

```sh
npm install
npm run dev      # dev server
npm run build    # tsc -b && vite build
npm run lint     # oxlint
```

Deploys to GitHub Pages via Actions on push to `main`. `vite.config.ts` sets
`base` to the repo path; override with `VITE_BASE=/` for a custom domain.

## Stack

React 19 · TypeScript · Vite · `idb` · `lz-string`. Video playback uses the
YouTube IFrame Player API and the Twitch Embed API, both loaded from their CDNs.
