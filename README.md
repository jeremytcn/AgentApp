# Availability Simulator

Standalone, single-property room availability tool. Pulls live occupancy
from YSuite's RMS middleware, same endpoint the main Room Availability
Dashboard uses, but scoped to one property with a simpler setup and display.

## Local development

```
npm install
cp .env.example .env   # fill in the three values below
netlify dev
```

Requires the [Netlify CLI](https://docs.netlify.com/cli/get-started/) for
`netlify dev` (runs the functions + serves `public/` together, and picks up
`.env` automatically).

## Environment variables

Set these in the Netlify site's dashboard (Site configuration >
Environment variables) for production, or in `.env` locally. Never commit
a real `.env` file.

| Variable              | What it is                                                        |
|------------------------|--------------------------------------------------------------------|
| `YSUITE_API_BASE_URL`  | YSuite middleware base URL. Defaults to `https://middleware.ysuites.co` if unset. |
| `YSUITE_JWT`           | Bearer token sent on every request. Static — no rotation; replace manually if it expires. |
| `YSUITE_PROPERTY_ID`   | This property's RMS property ID.                                  |

Property name is the one non-sensitive, editable field — it's stored in
Netlify Blobs via the Setup console, not an env var, so it can change
without a redeploy.

## Deploy

Push this to a Git repo and connect it as a new Netlify site (or `netlify
deploy` directly). Set the three environment variables above in the site's
dashboard before the first real sync.

## What's real vs. simplified here

- The request/response contract, and the status-precedence logic in
  `netlify/functions/lib/status.js`, are carried over from the main
  dashboard's `availability.js` — same `POST .../check-room-occupancy`
  call, same `Confirmed | Arrived | Unconfirmed | Available | Unavailable`
  resolution rules.
- Floor and shared-unit (2/3 Bedroom) detection are derived from the room
  name string itself (`netlify/functions/lib/room-mapper.js`), per the two
  real examples given: `"02.02 YSMG"` → single room, floor 2; `"17.12.1"` /
  `"17.12.2"` → two bedrooms of unit `17.12`, floor 17.
- Gender isn't in the current payload (not yet in this JWT's scope). The
  mapper reads `r.gender` if present and normalizes it; until the field
  exists, every room's gender is `null`, so every shared unit shows up as
  "Full Unit" once it's fully available, and Male/Female stay at 0.
- Availability-for-a-date-range is computed client-side from whatever
  YSuite gives us per room: for a currently available room, "available
  until" its next known booking (or indefinitely, if none); for a booked
  room, its current lease's start/end. There's no visibility into bookings
  *after* the current/next one, so a far-future date range on an
  otherwise-available room may show as available when it later turns out
  not to be.

## Open items — verify against real data before relying on this

1. **Room name parsing is built from exactly two examples.** Check it
   against a full real payload, especially: does every single-occupant
   room name reliably have a space before its trailing label (so it can't
   collide with the 3-segment shared-unit pattern), and does a 3-bedroom
   unit's third bedroom render as `"X.Y.3"` the same way?
2. **Room type name matching.** `roomType` is taken from `roomTypeName` (or
   `categoryId` as a fallback) and matched directly against the 7
   configured names. Any room whose type doesn't match one of the 7 is
   excluded from the table and surfaced separately as "unmapped" — check
   that note on first real sync to catch any naming mismatch early.
3. **Gender field.** Currently unavailable from the API (JWT scope). Once
   it's added, confirm: is it reported per bedroom, and does YSuite already
   enforce "same gender per shared unit," or does that still need
   client-side reconciliation? The mapper/aggregation already tolerate a
   mismatch between bedrooms in the same unit (flagged as "⚠ mismatched" in
   the UI) rather than silently picking one — worth deciding if that's the
   right behavior once real data exists.
4. **No authentication on this deployment.** It's built for Jeremy's own
   use with no login. If this is ever shared more broadly, put it behind
   Netlify's site-wide password protection (or a real auth layer) first —
   the JWT and property ID are safe (env-only), but the sync trigger and
   cached data currently aren't gated at all.
