# Availability Simulator

Standalone, single-property room availability tool. Pulls live occupancy
from YSuite's RMS middleware, same endpoint the main Room Availability
Dashboard uses, but scoped to one property with a simpler setup and display.

## Local development

```
npm install
netlify link           # connects this folder to the real Netlify site -
                        # needed so Blobs works locally, see note below
cp .env.example .env    # fill in the three values below
netlify dev
```

Requires the [Netlify CLI](https://docs.netlify.com/cli/get-started/) for
`netlify dev` (runs the functions + serves `public/` together, and picks up
`.env` automatically).

**Do not add `NETLIFY_SITE_ID` or `NETLIFY_BLOBS_TOKEN` to `.env` yourself.**
`netlify link` makes `netlify dev` inject them automatically when needed —
the code uses them if it finds them in the environment and falls back to
Blobs' normal auto-detection otherwise. Adding them to `.env` yourself with
blank values breaks that fallback by overriding it with nothing.

## Environment variables

Set these in the Netlify site's dashboard (Site configuration >
Environment variables) for production, or in `.env` locally. Never commit
a real `.env` file.

| Variable              | What it is                                                        |
|------------------------|--------------------------------------------------------------------|
| `YSUITE_API_BASE_URL`  | YSuite middleware base URL. Defaults to `https://middleware.ysuites.co` if unset. |
| `YSUITE_JWT`           | Bearer token sent on every request. Static — no rotation; replace manually if it expires. |

Property ID is **not** an environment variable — it's set in Setup >
Property Information and read directly from there by the live sync
(`availability.js` reads `rates.js`'s stored `property.propertyId`). This
was a deliberate change: unlike the JWT, a property ID isn't a credential,
and keeping one copy in Setup avoids it silently drifting out of sync with
whatever's typed into Property Information. Property name and floor
ranges live there too — all non-sensitive, editable at runtime without a
redeploy.

## Deploy

Push this to a Git repo and connect it as a new Netlify site (or `netlify
deploy` directly). Set the three environment variables above in the site's
dashboard before the first real sync.

## Layout

Navigation (Agent / Reservation / Rates / Floor Plan) is a **top nav bar**
above each page's own header, not a left sidebar — that's a deliberate
change from an earlier version. The sidebar was eating ~200px of width on
every page, which made the Rates page's calculator content visibly
narrower than the same layout in the standalone Lease Rate Simulator
artifact. `.shell`'s max-width was also brought up to 1180px to match the
artifact's own `.wrap` exactly. Setup stays a separate full page (reached
via the gear icon), unaffected by this — it never had the sidebar.

## Two views

- **Agent** — the aggregate dashboard: date range, availability pills per
  room type, gender split (Male/Female/Full Unit) for shared units.
- **Reservation** — a per-room table mirroring the main Room Status
  Dashboard: stat cards (Total rooms / Available now / Occupancy rate /
  Arriving today / Departing today), search, room type + status filters, a
  date range filter, sortable columns, and an expandable row per room
  (guest name, res #, nights, bond paid, ADES, lease dates, floor, gender).
  **Assumption to verify**: the date range filter here shows rooms
  *available* for that range (same logic as Agent view) — the real
  dashboard's two date fields might filter by something else (e.g. arrival/
  departure date directly). Worth confirming side-by-side.

## Lease Rate Simulator merge (in progress)

The Lease Rate Simulator prototype (a separate claude.ai artifact,
`localStorage`-backed) is being folded into this project as a new
**Rates** sidebar entry, per `HANDOVER.md` (the calculation-engine and
Setup Console spec it was built from - keep this doc, it's the source of
truth for exact behavior).

**Done:**
- `netlify/functions/rates.js` — GET/POST for the whole rate config
  (property info + rate cards + promotions), replacing `localStorage`.
- `netlify/functions/rates-media.js` — real Blobs-backed storage for room
  images/videos, replacing the prototype's inline base64 data URIs.
- `netlify/functions/seed-rate-cards.js` — one-time migration script; run
  once against a real localStorage export (see the script's own header for
  the exact browser-console command to get that export) to carry over
  real rate cards, pricing, promotions, and photos/videos instead of
  starting from an empty config. Tested end to end against Jeremy's real
  exported data before being handed over.
- Setup Console merged into one tab set: **Property Information → Room
  Information → Rate Cards → Promotions → Floor Plan**. Property
  Information is fully built (property name, property ID pre-populated
  from the real connected property, High/Low floor ranges in the Rate
  Simulator's plain min/max format with soft overlap warning, currency,
  rate type, security deposit/bond/advance rent, and read-only API base
  URL / JWT status). `config.js` was removed - property name and floor
  ranges now live in `rates.js`'s `property` object instead, and the
  Agent/Reservation views' floor-tiering (`resolveTier`) reads from there.
- **Real concurrent-edit handling**, not last-write-wins: every save is
  version-checked (`expectedVersion` must match the config's current
  `_version`, or the save is rejected with the current data instead of
  silently overwriting someone else's change) plus a soft presence lock
  (heartbeat every 10s while Setup is open) that shows a "so-and-so is
  currently editing this" banner without blocking anyone - given only a
  handful of people ever have edit access, a hard mutex would cost more in
  UX than it protects against. Verified end to end with a scripted
  two-editor scenario (both load, one saves, the other's stale save is
  correctly rejected and shown the current data, a retry with the fresh
  version succeeds) before this was handed over.
- **Room type rows in the not-yet-built Rate Cards / Room Information
  tabs will be pre-populated from `DISPLAY_TYPES`** (the same base-type ×
  High/Low list Agent/Reservation already compute from the shared floor
  range), not free-typed - the name becomes a locked label, only Short
  Name (Room Information) and per-term prices (Rate Cards) stay editable.
  Confirmed this matches Jeremy's real data already (all 7 row names in
  his export line up with `DISPLAY_TYPES` exactly).

- **Property ID is no longer an environment variable.** It's read live
  from Setup > Property Information (`rates.js`'s stored `property.
  propertyId`) by the real sync (`availability.js`). Tested end to end
  with a Blobs mock: an empty config correctly reports no property ID,
  saving one in Property Information makes the live sync pick it up
  immediately, with no redeploy. `YSUITE_PROPERTY_ID` is gone from
  `.env.example` entirely.
- **Room Information tab is built and working**: one block per
  `DISPLAY_TYPES` entry (name locked, per the design above), an editable
  20-character Short Name, image upload/thumbnail-grid/delete, and a video
  section (either a URL/link or an uploaded file, both deletable, each
  with its own caption). Uploads go straight to `rates-media.js` for a
  real asset id; the config change (referencing that id, a short name
  edit, a caption edit) only takes effect on the shared, version-checked
  Save — consistent with Property Information rather than a separate save
  path.
- **Rate Cards tab is fully built**, including Check-in/Check-out
  Availability: a pill row to switch between cards (with delete) and "+
  Add rate card"; per-card Name and Utilities (labeled Weekly/Monthly to
  match `rateType`); the 3 fixed Lease Term blocks (editable label +
  min/max nights, blank max = unbounded, with the required soft
  overlap-warning); a Room Types pricing table with rows locked to
  `DISPLAY_TYPES` (reconciled automatically — verified this correctly
  drops the blank 8th slot from Jeremy's real export while preserving all
  7 real prices exactly); and Check-in/Check-out Availability rule editors
  per HANDOVER.md §2.5 — start/end/day-of-week, blank end date = a single-
  date rule vs. a range, rules render as pills (single = 1/10 grid width,
  range = 3/10), and adding a new Check-in rule is rejected with an alert
  if it overlaps another rate card's Check-in window (Check-out rules
  aren't subject to this). `expandRule` matches the spec's own pseudocode
  exactly, so the eventual calculator's card-routing logic can reuse it
  unchanged. Tested directly against Jeremy's real rules (a weekday-
  filtered Tuesday range across Sep–Oct 2026, three single-date rules in
  Feb 2027): weekday filtering returned only actual Tuesdays, and the
  cross-card overlap check correctly caught/allowed the right cases in
  both directions.
- **Promotions tab is built**, covering all 4 types from HANDOVER.md
  §3.5-§3.9: Weekly Rate Rebate (with its 4 sub-types — Rates, Discount,
  Override, Rent Free — each showing only its own relevant fields),
  Promotion Period (per-term Amount + Mid Lease %, capped at 99), and Add
  On (free text). Room scope is a checkbox list over `DISPLAY_TYPES`
  (unchecked/empty = all rooms, per spec); Override pre-fills each cell's
  *placeholder* with the room's current rate rather than its value, so a
  blank cell means "unchanged" not "set to 0", also per spec. The §3.6
  cross-promotion conflict check is implemented and runs after every
  relevant edit (room checkbox, term checkbox, override cell, start/end
  date) — a conflicting change is rejected with the spec's exact message
  format and the field is reverted, not silently applied. Tested directly
  against constructed conflict/non-conflict scenarios covering all 3
  combo-generating sub-types (rates, discount/rentFree, override) crossed
  with matching/different rooms, terms, and overlapping/non-overlapping
  dates — including one case that looked like a bug at first (a room-
  scoped promo conflicting with an all-rooms promo) but turned out to
  correctly reflect the "empty roomTypeNames = all rooms" rule once
  checked against the spec.
- **The calculation engine and calculator page are built** (HANDOVER.md
  §2.4, §3) — a new **Rates** sidebar entry, separate from Setup. The
  engine (`computeBooking` and its helpers) is pure, dependency-free
  functions, deliberately kept independently testable rather than wired
  straight into rendering:
  - `prorate`/`calcWeekly`/`calcMonthly` — the core proration math, with
    `addMonthsISO` correctly clamping month-length overflow (Jan 31 + 1
    month = Feb 28, not rolling into March)
  - `findRateCardForCheckIn` — multi-card routing by check-in date,
    exactly matching the spec's own pseudocode
  - `resolveRateRebateEffective` — first-match-wins Weekly Rate Rebate
    resolution across all 4 sub-types, independent rate/utilities slots
  - `collectRentFreeEntries`/`collectPromotionPeriodEntries`/
    `collectAddOnEntries` — the lump-sum and informational promotion types
  - `computeBooking` — assembles all of the above into one result,
    including the gross-vs-effective "Workings" breakdown
  - `computePayableToday` — Deposit/Bond/Advance Rent off the
    **post-rebate** rate

  **Tested extensively before being wired into any UI** — 74 assertions
  across four batches: date/proration math (including the exact
  full-period-reproduces-the-rate-exactly property), rebate sub-type
  resolution with first-match-wins/date-scoping/room-scoping, Rent Free
  stacking (multiple applying at once, unlike the single-winner rebate
  model), Promotion Period mid/end splitting, and — specifically — the
  gross/effective double-subtraction bug HANDOVER.md §3.5 calls out as a
  real historical bug: confirmed the rate-rebate delta shown for display
  is never subtracted a second time from the final total. Also sanity-
  checked end-to-end against Jeremy's real, live data (a real "rates"
  sub-type promo correctly copying the Full-Year rate onto a Half-Year
  stay) and the calculator page's own render (result shown, no-result, and
  error states, div-balance-checked in each).

  The calculator page itself: Check-in becomes a dropdown (not a free date
  picker) once any rate card has Check-in rules, populated with the union
  of every card's valid dates; Check-out is rebuilt from the resolved
  card's own Check-out rules every time Check-in changes, and is
  structurally disabled until a Check-in is chosen. Total Payable Today
  sits behind a "?" toggle, hidden by default, per spec.
- **Compare Rooms mode is built** — a "+ Compare Rooms" pill on the
  controls row reveals a second Room type select; Calculate then computes
  both rooms against the same dates and shows two calculation cards side
  by side. Verified with real data that the two results are genuinely
  independent (different totals for different rooms), and that the UI
  cleanly reverts to the single-card layout when compare is toggled back
  off.
- **Calculator page redesigned to match the Lease Rate Simulator artifact
  exactly** — pulled the artifact's actual source (not just the
  screenshots) and matched its calc-card, rate-card-summary, and
  promotions-panel markup and CSS class-for-class: the same `.calc-card`
  layout (WEEKLY/MONTHLY tag, method sentence, rowlines with struck-
  through gross rate next to the effective rate, add-ons, image/video
  gallery, amber "Total lease amount" box, collapsed-by-default Workings
  breakdown), the same `.calc-grid.single-mode`/`.compare-mode` column
  layout, and a **Rate Card Summary + Promotions panel that didn't exist
  in this project before** — a read-only summary table (gross vs.
  effective price per room × term, evaluated against today's date so
  "Always active" promotions show their effect) and a promotions list
  with the exact same badge/description/date-range formatting as the
  artifact. Verified the promo description text is **byte-for-byte
  identical** to the artifact's own output against Jeremy's real
  promotions data (e.g. "Replace Short-Term, Half-Year rate with Full-
  Year rate — All room types"). Also fixed `formatMoney` (was always
  showing 2 decimals; now matches the artifact's whole-number-when-exact
  behavior) and `formatDateDMY` (now zero-pads the day, e.g. "07 Jul
  2027" not "7 Jul 2027") to match exactly. The Workings/Total-Payable-
  Today toggles are now pure DOM manipulation with no `render()` call,
  matching the artifact's own approach — consistent with the heartbeat fix
  below, and avoids introducing the same class of bug a second time.
  **Scope note**: kept this app's own top bar (property name, Sync button,
  gear icon) rather than the artifact's standalone header, since this
  calculator is one page among several in a single app now — the redesign
  is about the calculator's own content area, which is what the
  screenshots were actually showing.
- **Lightbox/carousel viewer for the room gallery** — clicking a thumbnail
  now opens a full-screen viewer in place (not a new tab), with prev/next
  navigation when there's more than one item, keyboard arrows, swipe-to-
  navigate on touch, and Escape/click-outside to close. Ported directly
  from the artifact's own `ensureLightbox`/`openLightbox` implementation,
  same CSS. Images show full-size; uploaded video files play inline via
  `<video>` (pointed at `/api/rates-media`); link-type videos (YouTube,
  Matterport, etc.) show an "Open video ↗" fallback rather than an embed —
  confirmed this matches the artifact's actual behavior, not a
  simplification: its lightbox never embeds an iframe for link-type
  videos either, regardless of host.

## Room Information: thumbnail size and Upload button placement (latest pass)

- Thumbnails shrunk from 84×84px to 40×40px, matching the "+ Upload
  images" button's own natural height (padding-driven, roughly the same
  now).
- "+ Upload images" moved to be a sibling of the thumbnails inside the
  same image grid, rather than sitting on its own line below them - it
  now sits directly beside the last thumbnail, on the same row, wrapping
  naturally alongside them.

## Login and role-based access control (latest pass)

A real authentication layer, not just a cosmetic gate - every backend
function now requires a valid session, and write/save actions require
the admin role specifically, so hiding a tab in the UI is backed by the
same restriction on the API itself, not just app polish.

**Three roles:**
- **Admin**: full access, including Setup Console. The only role that can
  write/save anything.
- **Internal**: view-only, every frontend tab (Availability, Room List,
  Rates, Floor Plan), no Setup Console.
- **Agent**: view-only, Availability and Rates tabs only. Logs in with
  just a username - no password at all for this role, by design.

**Login page**: a toggle between "Username & password" (Admin/Internal)
and "Username only" (Agent). Sessions last 12 hours, persisted in
localStorage so a refresh doesn't force a re-login, but always
re-validated against the server on load rather than trusted blindly - a
revoked or expired token falls back to the login screen immediately, on
any request, not just at startup.

**Backend**: new `lib/auth.js` (password hashing - salted scrypt, never
plain text; session creation/validation; role checks), `auth.js`
(login/logout/session-check), `users.js` (admin-only user management,
plus a one-time bootstrap action for the very first account). Retrofitted
session checks into every existing function (`rates.js`, `availability.js`,
`floorplan.js`, `floorplan-image.js`, `rates-media.js`) - reads need any
valid session, writes need the admin role. One disclosed trade-off: the
two image-serving GET endpoints (floor plan photos, room images) stay
unauthenticated, because they're loaded as plain `<img src>` tags in the
browser, which can't attach an Authorization header - everything else,
including every write, is gated.

**New "Users" tab** in Setup Console (admin-only, same as the rest of
Setup): list existing users, add a new one, enable/disable, delete - all
through `/api/users`, all admin-only. An admin can't delete their own
account by accident.

**⚠ Required one-time step after deploying this**: nobody can log in
until at least one admin account exists, and there's no UI to create the
first one (deliberately - that path is unauthenticated by necessity,
since no session exists yet to require, so it's a separate script run
once from a trusted machine, not reachable the way a login attempt is):

```
node seed-admin.js <site-url> <username> <password>
```

e.g. `node seed-admin.js https://ysuiteagent.netlify.app admin "SomeStrongPassword123!"`.
This only works once - the moment any user exists, this same command
(or a repeat of it) is refused, and further users are managed from the
Users tab instead.

Tested extensively given the security stakes here: password hashing and
verification (including that different salts produce different hashes
for the same password); the full login/logout/session-check flow across
every scenario (correct/wrong password, the weak agent-only login not
leaking to other roles, disabled accounts, expired/invalid tokens); the
one-time bootstrap genuinely only working once; every retrofitted
function's auth gate (401 with no session, 403 for a non-admin write,
success for an admin); the frontend's role-based nav/gear-icon hiding;
a safety redirect if a role somehow ends up on a view it shouldn't see
(defense in depth beyond just hiding the nav tab); the `api()` helper
correctly attaching the session token and correctly dropping back to the
login screen on a 401 from any request, not just login itself.

## "Test connection" renamed to "Sync" (latest pass)

Renamed everywhere it appeared - the button itself, its in-progress state
("Testing…" → "Syncing…"), and the three other hint messages elsewhere
in the app that referenced it by name.

## Real upload bug found, and Room Name Conditioning now supports multiple patterns (latest pass)

- **"Upload failed: floor is not defined" - a genuine JavaScript bug,
  found and fixed.** The success-message code referenced a bare `floor`
  variable that was never declared anywhere in that function's scope -
  the correct one, `fe.floor`, was sitting right there the whole time but
  never used. This explains the earlier "error persists even after a
  successful upload" report too: the upload was succeeding on the server
  every time, but building the success message crashed with this exact
  ReferenceError on *every single upload*, which is what the `.catch()`
  handler was displaying as a failure - not an occasional race, a
  guaranteed crash. Verified the fixed line directly, both the
  single-floor and multi-floor-grouped message variants.
- **Room Name Conditioning now supports one pattern per distinct field
  count**, not just a single pattern for whichever room happened to have
  the most fields - exactly Jeremy's own proposal (one example for a
  3-field name, one for a 4-field name), generalized to however many
  distinct counts the synced rooms actually contain. This was the real
  cause of "a majority of rooms are not listed" and "not split into high
  and low" - forcing every room through one fixed field-count pattern
  left whichever count wasn't the "most fields" one unclassified, even
  though its own pattern was perfectly parseable on its own terms. Each
  room is now matched against the pattern for its own field count
  independently. Data model moved from a single `roomNameFields` array to
  `roomNameFieldsByCount`, keyed by field count. Tested directly against
  the exact mixed scenario: a majority of 3-field rooms and a minority of
  4-field rooms, both patterns configured independently, and confirmed
  every room - majority and minority alike - now correctly resolves its
  floor and shared-unit grouping.

## "Sync rooms" removed - genuinely redundant with "Test connection" (latest pass)

Confirmed before removing anything: both buttons hit the exact same
`/api/availability` POST endpoint and updated the exact same state
(`rooms`, `syncedAt`, `connection`, `nextSyncAllowedAt`), sharing the same
cooldown. The only difference was Test connection also showed a
confirmation message ("Connected — N rooms returned from YSuite"), making
it strictly more informative for the identical underlying action -
Jeremy was right that having both side by side was redundant.

Removed "Sync rooms" entirely: the button, its dedicated `doSync()`
function (now unused anywhere), and the now-dead `state.syncing` flag
that only it ever set. Test connection is the only way to sync now.
Found and fixed four stale hint messages left over from when Sync rooms
still lived in the shared topbar on Agent/Room List (before it moved into
Setup > Property Information a couple of passes back) - they were still
telling people to go sync from Agent or Room List, which no longer does
anything there; all four now correctly point to Setup > Property
Information's "Test connection" instead.

## Real Stamp Duty CSS bug found and fixed; two more width fixes (latest pass)

- **The Stamp Duty checkbox was genuinely broken, not just mis-sized** -
  `.floor-range-row input` was styling *every* input in that row
  (width, padding, border, border-radius) with no exception for
  checkboxes, so the checkbox was inheriting a 90px width and 9px/10px
  padding meant for text/number inputs - exactly the malformed
  rectangle-with-a-square-inside look in the screenshot. Fixed by
  excluding checkboxes from that selector entirely
  (`input:not([type="checkbox"])`), so it renders as a normal checkbox
  again.
- **Room Name Conditioning's four fields were flex-growing to fill the
  row**, which is what was spreading them apart rather than sitting
  packed together - changed to a fixed width instead, same fix pattern as
  several other "not sitting beside each other" reports in recent passes.
- **Property Name was also flex-growing** to consume all the row's
  leftover space, which is what pushed Short Name/Property ID/High Floor
  From out to the far right with a large gap between them - given a
  fixed width instead, matching how the other three fields in that row
  are already sized.

## Property ID field width fixed to match the reference screenshot (latest pass)

Property ID had no explicit width set at all - its wrapper doesn't grow
to fill space (by design, so it sits close to Short Name), which left the
input with nothing definite to size itself against, so it fell back to
the browser's own narrow default rather than comfortably fitting a full
ID string. Given an explicit width instead. Compared the rest of the
page against the screenshot too (Rates row, Room Name Conditioning
table, the Connection row with Sync/Test side by side, bright labels
throughout) - those already matched from earlier passes, so this was the
one real gap.

## Sync/Unit/Mismatch buttons relocated; Room List's expand limit (latest pass)

- **"Sync rooms" moved out of the shared topbar entirely**, into Setup >
  Property Information, beside "Test connection" - the only place a sync
  can be triggered from now. The two "no data yet" empty states on Agent
  and Room List no longer offer their own sync button either; they point
  to Setup > Property Information instead, so there's exactly one trigger
  in the whole app, not three.
- **"N Unit ⚠" and "N Mismatch" now only appear on Room List**, not on
  Agent, Rates, or Floor Plan - they only ever existed to jump to Room
  List's own filtered view anyway, so showing them elsewhere just to
  trigger a tab change stopped making sense once Sync (the button they
  used to sit beside) moved to Setup.
- **Room List: at most 5 rows can be expanded at once.** Expanding a 6th
  closes whichever one was expanded *longest ago*, not just an arbitrary
  "first" - tracked with an explicit expansion-order list, not just the
  order object keys happen to iterate in. Built as one shared function
  used by both of Room List's two row-click handlers (the main render and
  the search box's own surgical redraw, which exists separately so typing
  in the search field doesn't lose focus on every keystroke) - the two
  were already a known duplication risk, so this was a good moment to
  finally put the rule in exactly one place rather than risk them
  drifting apart on it. Tested directly: expanding a 6th correctly evicts
  the oldest of the 5; collapsing a room correctly removes it from the
  order tracking too (not left as a stale entry); re-expanding it
  afterward correctly places it at the end as the most recent again.

## Floor plan upload race condition, and a removed hint (latest pass)

- **Real bug: the upload error message could persist even after a
  genuinely successful re-upload.** No two upload attempts were ever
  guarded against each other - if a slow, ultimately-failing first
  attempt's response didn't come back until *after* a faster second
  attempt had already succeeded, the first attempt's late failure landed
  last and silently overwrote the correct success message with a stale
  error. Fixed with an attempt id bumped on every click; a result is only
  ever applied if it's still the most recent attempt, so a superseded one
  is silently ignored instead of overwriting a fresher result. Verified
  directly by simulating the exact race (a fast, correct success
  resolving first, a slow, stale failure resolving after it) - confirmed
  the final message is the success, not the stale failure.
- Removed the explanatory hint text under Room Name Conditioning per
  Jeremy's request.

## Room Name Conditioning - configurable per-property room-name parsing (latest pass)

The real fix for "shared unit gender accounting broken on this property" -
built from Jeremy's own proposal after discussing a few refinements
first. Root cause: room grouping (floor, shared-unit detection, unit key)
was a single hard-coded parsing pattern in the backend, silently
mis-grouping any property whose room names don't match that one specific
shape - exactly what happened here (3 available rooms of one apartment
type showing only 1 Full Unit, with a gender unaccounted for, because two
of the three weren't being recognized as siblings of the same unit at
all).

**New Setup > Property Information section, "Room Name Conditioning":**
shows one real example room name - specifically the synced room whose
name splits into the *most* fields (splitting on whitespace and common
separators), so the config covers the most complex real case - with a
dropdown per field position to assign its role: Flooring, Unit,
Shared/Not, or Short Name. One config, applied uniformly to every room.

- **Flooring + Unit** together decide which rooms are siblings of the
  same apartment. **Shared/Not** distinguishes them within that group -
  if every room in a Flooring+Unit group shares one identical value,
  it's a single room, not shared; more than one distinct value makes it
  a shared apartment, one bedroom per value - exactly Jeremy's own
  proposal, confirmed before building.
- **Flooring is expected to be numeric**, with a letter fallback (a=1,
  b=2... z=26, extending spreadsheet-column-style beyond that) for a
  property that names floors with letters instead - so High/Low tiering
  and Floor Plan's own floor tabs still get a real number to work with.
- A room whose name doesn't split into the same number of fields as the
  example is left unclassified (no floor, no unit key) rather than
  guessed at.
- **Short Name** is no longer typed in by hand - Property Information's
  "Short name" field is now read-only display text, derived straight
  from whichever field position is assigned that role, since every room
  shares the same token.
- A property that hasn't configured this yet is completely unaffected -
  the whole thing is a no-op until a mapping is actually set, so nothing
  about the old hard-coded parsing changes for properties that already
  work correctly with it.

Verified directly against the exact reported shape: three rooms of one
apartment (two distinct Shared/Not values plus a genuine third bedroom)
now correctly group as one shared unit with the right Full Unit count,
instead of reading as ungrouped singles; a real separate single-room
apartment elsewhere stays correctly ungrouped; Short Name derives
correctly from the configured field; and the whole thing is a no-op for
a property with no configuration at all.

## "Confirmed" reservation data - made robust across properties (latest pass)

Real bug: after switching to a new property, "Confirmed" rooms in Room
List stopped showing detail again - because the earlier fix (checking
`r.nextReservation` for Confirmed bookings) was based on one property's
convention, and this new property structures its own Confirmed bookings
under plain `r.reservation` instead, like Arrived/Unconfirmed already do.
Hard-coding either field for "confirmed" universally was always going to
break on whichever property didn't match it.

Fixed by checking whichever field actually *has* real reservation data (an
id, or an arrival/departure date) rather than assuming one specific field
name for the status - tries `r.reservation` first, falls back to
`r.nextReservation` only if the first one is empty. Tested directly
against both real conventions (the property that needs `nextReservation`,
and this new one that needs plain `reservation`), plus the edge cases of
both being present (the first one correctly wins) and neither being
present (stays gracefully empty, no crash).

## Property reset scope widened; floor plan uploads now resized client-side (latest pass)

- **Property reset now also resets Property Name, Short Name, Currency,
  Rate Type, Security Deposit, Bond, Advance Rent, and Stamp Duty** to
  blank/default values on a Property ID change - these were deliberately
  left untouched in the original design (confirmed with Jeremy at the
  time), but he's now asked for them to reset too. Tested directly
  against the exact fields he reported: all eight now correctly return
  to their default state (blank name/short name, first currency in the
  list, "Weekly" rate type, 0 for the three deposit-style figures, Stamp
  Duty off with no percentage) alongside everything that already reset.
- **Real bug in the floor plan upload path, traced to its actual root
  cause.** The "Upload failed - network error" message this time came
  with a real error log: the local Netlify CLI dev server itself was
  crashing ("Stream body too big"), not a timeout or a bug in my
  function code - a large camera photo, base64-encoded (which inflates
  size by roughly a third), was exceeding a request body limit somewhere
  in the request path before the function ever ran. Rather than treat
  this as an unfixable third-party tool crash, added client-side image
  resizing before any upload ever leaves the browser: downscales to a
  1800px max dimension and re-encodes as JPEG, which only ever shrinks
  an image (never upscales one already smaller than that), preserving
  aspect ratio. This reduces the odds of hitting *any* body-size limit -
  the local dev server's own limit, or Netlify Functions' 6MB limit in
  production - not just the one that happened to crash this time.
  Verified the core scaling math directly: a large landscape or portrait
  camera photo correctly downscales to fit within the cap with its
  aspect ratio intact, while a small image already under the limit is
  left at its original size rather than being scaled up.

## Nav rename, new empty "Users" tab (latest pass)

- Top nav tab "Agent" renamed to "Availability" (display label only -
  internal view id `agent` and every function name referencing it are
  unchanged, same reasoning as the Reservation → Room List rename a few
  passes back). Updated the two other places that mentioned "Agent" by
  name in hint text ("Head to Agent or Room List...", "run a sync on
  Agent or Room List...").
- Added a new "Users" tab to the Setup Console tab bar, after Floor Plan.
  Left intentionally empty per Jeremy's request - a plain placeholder
  ("Nothing here yet") rather than any real functionality, ready to be
  built out later.

## More Setup Console layout fixes (latest pass)

- **Property Information**: Stamp Duty's checkbox container no longer
  extends wider than the checkbox itself - given an explicit fit-content
  width rather than relying on the surrounding flex layout.
- **Promotions "?" popover was opening at the far right of the whole
  header row, not at the button** - root cause: `position: relative` was
  set on the entire header row (which spans the full console width), so
  the popover's `right: 0` anchored to that row's far edge rather than
  the button sitting near the left of it. Fixed by giving the button its
  own small positioned wrapper and anchoring the popover to *that*
  instead - it now opens directly under the "?" icon regardless of how
  wide the row around it is.
- **Added the two requested bullet points under "Promotion Period"** in
  the popover - "Mid Lease = Halfway through the stay by nights." and
  "End Lease = 28 days before check-out." - as their own bulleted list,
  matching the Weekly Rate Rebate section's own bullet style.
- **Removed the divider/gap after Room Types** for every Weekly Rate
  Rebate sub-type (Rates, Discount, Override, Rent Free) - it had a
  visible border-top plus 14px of padding and margin above it, which is
  what read as an unwanted line break; brought down to a small 8px gap
  with no divider line.
- **Floor Plan's "Floor(s)" field and Upload button still weren't sitting
  beside the image file field** even after last pass's fix - the real
  cause was the *image file field's own wrapper* still flex-growing to
  fill the row's leftover space, which is what was pushing everything
  after it away, regardless of how the second field's own width was set.
  Fixed by removing the grow behavior there too, so all three elements
  now sit tightly together based on their own content. Also updated the
  field's width to 15 characters, per the new instruction (was 21).

## Setup Console layout cleanup (latest pass)

- Removed the sub-text under "Setup Console" about the API base URL/JWT
  being environment variables.
- **Property Information**: Stamp Duty's label now sits above the
  checkbox/field, matching every other field in that row, instead of
  inline text beside the checkbox. Currency, Rate Type, Security Deposit,
  Bond, Advance Rent, API base URL, and JWT labels are all bright
  (`var(--ink)`) now instead of muted grey - scoped narrowly so it
  doesn't affect other places sharing the same base classes (Floor Plan's
  facility list uses the same row style with names that weren't part of
  this request). Short Name, Property ID, and High Floor From no longer
  have a large gap between them - Short Name's field wrapper was still
  flex-growing to fill space even after its input got narrower a few
  passes back, which is what pushed the others away from it; all three
  are now sized to their own content instead. The "Test connection"
  button (extracted into its own small function so it isn't tied to
  where the save bar happens to render) now sits directly beside
  "Connection (from environment)" rather than at the very bottom of the
  page, with its result message right underneath it instead of far away.
  Removed the High Floor From explanatory hint text.
- **Floor Plan**: removed the "Comma-separated floor numbers..." hint
  text. Renamed "Applies to floor(s)" to "Floor(s): E.g 9,10,11", and
  fixed its width to `21ch` (the header text is exactly 21 characters) -
  it was flex-growing to fill available space before, which is what
  pushed the upload button away from it despite all three already being
  in the same row structurally; sizing it to its own content instead
  brings everything together as asked.

## Property Information field constraints, and a new Stamp Duty line (latest pass)

- **Security Deposit, Bond, and Advance Rent** are now narrower (sized for
  a single digit) and can't go negative - `min="0"` on the field plus a
  real clamp (`Math.max(0, ...)`) in the save handler, since a `min`
  attribute alone doesn't stop someone from typing a negative number
  directly.
- **Short Name** is capped at 6 characters (`maxlength`, plus the same cap
  enforced in the save handler) and narrowed to match.
- **High Floor From** is capped at 2 digits (0-99, clamped the same way)
  and can't go negative, narrowed to match.
- **New Stamp Duty checkbox**, beside Advance Rent. Checking it reveals a
  percentage field (showing/hiding the field needs a full re-render, not
  a value-only update, since the field's presence itself is what's
  changing). The amount is a percentage of the *Total lease amount*
  shown in the Rates/Calculator page's own calculation - not the
  deposit/bond/advance sum - rounded up to the nearest whole currency
  unit, and appears as its own "Stamp Duty (X%)" line under Security
  Deposit in the Total Payable Today breakdown, included in that total.
  Tested directly against the exact given example: 2.5% of a $13,239
  lease correctly rounds up to $331, not down to $330.

## Three follow-ups: "?" position, Calculator defaults, Floor Plan pill labels (latest pass)

- **"?" info button now sits directly beside "Promotions"**, not pushed to
  the far right of the row - just dropped the `margin-left: auto` from
  last pass.
- **Rates/Calculator page's Check-in, Check-out, and Room Type now all
  default to their first option** on load, same reasoning as Agent's own
  date defaults from a few passes back - nothing sits blank waiting to be
  picked before you see any pricing. The existing stale-selection guard
  (clearing a Room Type that no longer exists in DISPLAY_TYPES) runs
  first, so a fresh default only kicks in once any leftover invalid value
  has already been cleared.
- **Floor Plan pill labels changed from "Floor N" to "LN"** (L1, L5, L13),
  in both the Setup Console's own floor tabs and the Frontend viewer's.
  Turned out no CSS change was actually needed for the width request -
  neither the pill buttons nor their container ever had a fixed width to
  begin with, so a 2-character "L5" and a 3-character "L13" already size
  to their own text naturally once the label itself changed.

## Promotions "?" info popover, copied exactly from the artifact (latest pass)

Didn't exist at all before this - Jeremy's screenshot was of the
reference artifact's own design, used to show where he wanted it added.
Pulled the real source rather than approximating: a small circular "?"
button sits to the right of the "Promotions" header, opening a popover
with the exact same content, word for word - Weekly Rate Rebate's four
sub-type bullets (Rates, Discount, Override, Rent Free), Promotion
Period's description, and Add Ons' description. Verified the generated
markup directly against the artifact's own text, character for character.

Click the button to toggle the popover; click anywhere else to close it -
added to the same document-level "close anything armed/open" click
handler that already closes a card or promotion's "Confirm ×" state, so
there's one consistent place this kind of outside-click behavior lives
rather than a separate listener per widget.

## Promotion Period: copied exactly from the reference artifact (latest pass)

Pulled the actual source again and matched it 1:1 this time - class
names, sizes, and colors, not an approximation:

- Term blocks are a plain flex row with 20px gaps (`.promo-terms-row`),
  not the rigid 3-column bordered grid from the previous pass.
- Field labels ("Rebate Amount", "Mid Lease %") are small 10.5px muted
  spans above each input (`.promo-override-field`), not uppercase
  letter-spaced labels.
- Number inputs are 64px, right-aligned, monospace (`.promo-term-input`),
  matching the artifact's own `.rc-range-input` exactly rather than this
  app's wider generic number field.
- The "(X% End)" hint and the Split checkbox use the artifact's own
  `.rc-availability-hint` (12px, accent-colored, monospace) and
  `.promo-mid-checkbox-label` classes.
- Added the free-text explainer that was missing entirely - "Mid Lease =
  halfway through the stay by nights. End Lease = 28 days before
  check-out." - word for word, same class, same placement (once per
  promotion, below the term row).

Verified directly against the reference markup: every class name matches,
the explainer text matches character for character, and the fields
render in the same order (Rebate Amount, then Mid Lease % + its hint when
split is on, then the Split checkbox last) with real production rate
card data.

## Floor Plan: dimming and stale-filter bugs, actually fixed this time (latest pass)

- **The selected room was still dimmed right along with the background** -
  root cause was the dimming technique itself: a separate, absolutely-
  positioned `<div>` styled with CSS `mask-image`/`-webkit-mask-image`
  pointing at an inline SVG data URI. That kind of CSS masking on a plain
  HTML element is inconsistently supported in practice, and can silently
  render as "no cutout at all" - exactly the reported symptom. Replaced
  entirely with a native SVG `<mask>`, defined and applied within the same
  `<svg>` that already draws the hotspot outlines (a `<mask>` on a plain
  `<rect>`, universally well-supported everywhere SVG itself is).
  Verified directly: the generated markup has no CSS `mask-image` left
  anywhere, the mask correctly has exactly one black cutout matching the
  selected room's own points, and the dim rect correctly references that
  mask by id.
- **Selecting a room, then changing a filter, kept showing the old
  selection instead of the filter's own matches** - the four filter
  controls (room type, status, both dates) and the reset button never
  cleared `spotlightRoom`, and a single clicked room was given unconditional
  priority over any filter in deciding what gets highlighted. Fixed by
  clearing the spotlight whenever any filter changes, matching how
  switching floor tabs already correctly did this. Verified directly: a
  spotlighted room is cleared the moment a filter changes, and the new
  filter's own value is still applied correctly in the same step.

## Reservation tab renamed to "Room List" (latest pass)

Display label only - the internal view id (`reservation`), state key
(`state.reservation`), and function names (`renderReservation`, etc.) are
unchanged, since renaming those would be a large, purely-cosmetic-benefit
refactor touching dozens of call sites for no functional gain. Updated
everywhere the old name was user-visible: the nav tab itself, the two
topbar buttons' tooltips ("Unit ⚠" and "Mismatch"), and the two "run a
sync first" hint messages that mentioned it by name.

## Floor Plan Edit/Copy build (latest pass)

Built the deferred Edit/Copy mapping feature. Edit and Copy only appear
for a room/facility that's already mapped - Finish shape and Clear points
still work exactly as before for tracing a brand-new shape from scratch.

**Edit** (sits between Finish shape and Clear points): clicking it turns
the existing shape's points into real draggable handles, with all three
adjustments Jeremy asked for from day one:
- **Move a point** - drag any handle directly.
- **Add a point** - click anywhere along an edge (not a real drag, just a
  click) and a new point is inserted there, spliced into the correct
  position in the points array so the shape's edges still connect
  correctly.
- **Move the whole shape** - drag anywhere inside the shape's body that
  isn't a handle or close to an edge, and every point translates together.

A single mousedown on the shape's body has to serve both "insert a point"
(a click) and "move the whole shape" (a drag) - disambiguated by how far
the mouse actually travels between mousedown and mouseup, not by where it
landed. Dragging updates the DOM directly on every mousemove rather than
calling `render()` (which would rebuild a lot of HTML on every pixel of
movement) - a single `render()` only fires once the drag actually ends, to
land on a fully consistent state. Nothing saves until "Finish shape" is
clicked, same as always.

**Copy** (sits beside Clear points): copies the current shape's points to
the next unmapped room, opened directly in edit mode for adjustment -
never auto-saves either. If every room on the current floor is already
mapped, it prompts for a floor number and defers to the first unmapped
room found there (or the next one after that, if the first is somehow
already mapped too) - tested directly against the exact reported example:
floor 3 fully mapped, prompted "5", lands on 05.01 YSMG; if 05.01 also
turns out to already be mapped, correctly falls through to 05.02 instead.

Also added the geometry this needed (`pointToSegmentDistance`,
`nearestEdgeIndex`) and tested both directly against a known triangle:
each of its three edges correctly matches a click near it, and a click in
the true center (far from every edge) correctly returns "no edge" -
meaning drag-the-shape, not insert-a-point.

## Six fixes across Rates, Floor Plan, Promotions, and a theme toggle (latest pass)

- **"Workings" renamed to "Price Breakdown"** in the Lease calculation
  container.
- **Floor Plan: clicking a room in the list now shows sub-info** - Res #,
  Gender, Available Until, Unavailable Until, in a compact 4-column strip
  under the clicked item. Built as its own smaller variant
  (`fpRoomDetailHtml`) rather than reusing Reservation's full 7-field
  detail panel, since only these 4 were asked for.
- **Setup > Promotions header row fixed**: Name was set to flex-grow,
  which pushed Start/End Date (and the delete button) all the way to the
  right regardless of how short the name was. Name no longer grows, so
  the dates sit right beside it as asked; the delete button already had
  `margin-left: auto` and correctly stays pinned to the true far right on
  its own.
- **Promotion Period tightened up**: the 3 lease-term blocks now sit with
  zero gap between them (a thin divider line instead, so they're still
  visually distinct), and Rebate Amount / Mid Lease % / Split are
  guaranteed to stay on one row (`flex-wrap: nowrap`, narrower number
  inputs) rather than occasionally wrapping once the Mid Lease % field
  appeared. Also fixed a real bug while in there: the "(X% End)" hint was
  computed correctly at render time, but the Mid Lease % field's own
  change handler never triggered a re-render, so the hint stayed frozen
  at whatever percentage was true when Split was first checked (always
  showing "50% End" no matter what you typed afterward, since 50% is the
  default). It now updates live as the number changes - e.g. 30% mid
  correctly shows "70% End".
- **Light/dark theme toggle added**, between Sync rooms and the gear
  icon. This app already had full theming support built into its CSS
  (light is the default; dark applies via `prefers-color-scheme` or an
  explicit override) - it just never had a control for it. The icon
  itself reflects the *destination*, not the current state (sun when
  currently dark, meaning "tap to go light"; moon when currently light) -
  the standard convention for this kind of toggle. An explicit choice is
  saved to `localStorage` and takes priority over the system preference
  on future visits; a small inline script right after the stylesheet
  applies any saved override before the page body even renders, so
  picking a theme that differs from the system one never causes a flash
  of the wrong theme while the main app script is still loading.

## Availability pill: "Last Room" at exactly 1 (latest pass)

Small follow-up: 1 room left now shows "Last Room" instead of "Last 1
room".

## Agent tab: date-aware pricing, a Promotions panel, and several smaller fixes (latest pass)

- **🔥 moved to the end of the room type name** instead of the front.
- **Gender split now shows "Male"/"Female"** instead of "M"/"F".
- **Availability pill thresholds updated** to spec: Available >20, Limited
  10-20, "Last N rooms" <10, Sold Out at 0 (kept the exact room count in
  the "last few" label rather than flattening it to a generic "Last Few" -
  more informative, and was already the app's existing behavior for that
  band).
- **The rate column is a real rework, not a relabel**: it now resolves the
  actual lease term from the selected Start/End dates (via the same
  `matchedColIdx` the Rates/Calculator page uses) instead of just showing
  the lowest of the 3 term prices, and shows a struck-through original
  price beside the effective one whenever a Weekly Rate Rebate promo wins
  for that room and term - the identical logic
  `renderRateCardSummaryPanel` already uses on the Calculator page, just
  driven by Agent's own selected Start date. The column header now reads
  "{rate card name} ({lease term})" so it's unambiguous which one is
  being shown. Verified directly: a 136-night stay against a real 3-term
  card correctly resolves to "Half-Year" and labels the column
  accordingly; a room/term a rebate promo actually wins for shows the
  strikethrough, one it doesn't win for shows a plain price.
- **New Promotions panel, beside the room type table at a 2:1 ratio**,
  reusing `renderPromotionsPanel` verbatim from the Rates/Calculator page
  rather than rebuilding it. It follows the same date-resolved card as
  the rate column above it - not a fixed Setup-selected card - so
  changing the Start date updates both the rate column and the
  promotions list together, exactly like the Calculator page's own
  Check-in-driven panels already do. Made `renderPromotionsPanel` itself
  null-safe as part of this (Agent can have no card resolved yet, which
  the Calculator page's own caller never actually hits), rather than
  guarding every call site separately.

## Hot Room is now per rate card, and split into two columns (latest pass)

- **Hot Room moved from property-wide to per rate card** (`card.hotRooms`,
  same as prices) - "YSMG 2026 Sem 2" and "YSMG 2027 Sem 1" can now each
  mark completely different room types as hot with completely different
  override quantities, independent of each other, exactly like every
  other per-card setting already works.
- **Agent reads Hot Room from whichever card the selected date actually
  resolves to** (via `findRateCardForCheckIn`), not from whichever card
  happens to be active in Setup - the same card its Weekly Rate column
  already uses, so the two stay consistent with each other. Verified
  directly: a date resolving to a card *with* an override shows the
  overridden count; a date resolving to a *different* card with no
  override for that type falls back to the real computed count, even
  though the first card is still the one open in Setup.
- **Split into two columns**: 🔥 (the toggle) and "Override Qty" (the
  number field), instead of one combined cell - same independent
  behavior as before (the number always overrides regardless of the
  toggle; the toggle only controls the icon), just laid out as two plain
  table columns now.

## The "Confirmed" bug - actually fixed, with the real cause from Jeremy (latest pass)

Root cause, confirmed directly by Jeremy against a real example: for
"Confirmed" status specifically (a guest with a confirmed booking who
hasn't arrived yet), YSuite puts the actual reservation details - id,
title, gender, arrival/departure dates, guest name - under
`r.nextReservation`, not `r.reservation`. Every other status (Arrived,
Unconfirmed) keeps using `r.reservation` as before; this is a quirk
specific to Confirmed. `room-mapper.js`'s `mapRoom` now reads from the
right field based on status, rather than assuming `r.reservation` always
holds it.

Tested directly against Jeremy's real example (Apartment 02.03 YSMG,
Confirmed, actual guest details under `r.nextReservation.id = 172149`):
every field now comes through correctly - Res# 172149, Title "Ms.", Floor
2, Gender Female, Nights 123 (calculated, not hardcoded - and matches),
Lease Start 25 Sep 2026, Lease End 26 Jan 2027. Also verified the fix
doesn't leak into anything it shouldn't: Arrived and Unconfirmed rooms
correctly keep reading from `r.reservation` and ignore a present
`r.nextReservation` entirely, and Available rooms' `availableUntil`
calculation (which already read `nextReservation` for a different,
unrelated purpose - the next upcoming booking date) is completely
unaffected.

## Book a Room Tour (Calendly widget) on Agent (latest pass)

Added the requested button, to the left of "Available rooms" in Agent's
filter bar, wired to Jeremy's real Calendly link.

- Calendly's `widget.css`/`widget.js` are injected once, at script
  startup, guarded against double-injection - not per-render, since a
  `<link>`/`<script>` pair only needs to exist once on the page regardless
  of how many times the app re-renders.
- The button itself doesn't use Calendly's own inline-`onclick` snippet
  pattern; it's a normal button wired through this app's usual
  `addEventListener` handling for consistency with everything else here.
- Calendly's script loads `async`, so a very fast click right after page
  load could beat it - handled with a short retry loop (up to ~5s) rather
  than assuming `window.Calendly` is already there, with a plain alert
  only if it genuinely never shows up. Tested both paths directly: an
  immediate call when Calendly's already loaded, and the retry correctly
  picking up the popup once the script finishes loading partway through
  the wait, without needing a second click.
- Layout note: `.filter-bar` uses `justify-content: space-between` with
  exactly two children by design (the date fields on the left, everything
  else on the right) - the button and the "Available rooms" figure are
  wrapped together in one small flex group instead of being separate
  top-level children, so the button sits directly beside the figure
  rather than getting evenly spaced across the whole bar.

## Promotions: positioning follow-ups (latest pass)

- **"Copy rate from term" now renders before "Apply to term(s)"**, matching
  the label swap from last pass (only the DOM order changed - the
  underlying field bindings and calculation behavior are untouched).
- **Rebate Amount, Mid Lease %, and the Split checkbox now sit in one row
  together** in Promotion Period, instead of each stacking on its own
  line - wrapped in a shared flex row per lease term, with the Split
  checkbox's own vertical alignment nudged to match the labeled number
  fields beside it.

## Promotions polish and check-in-driven Rate Card panels (latest pass)

- **Agent's top "Available rooms" figure now reflects Hot Room overrides
  too** - it was only applied to the per-row Available column and the
  table's own footer total before, not the number shown at the top of the
  page, so the two could visibly disagree. Computed once, reused in both
  places, so they can no longer drift apart.
- **Override sub-type: empty room types now genuinely means no rooms**,
  not every room type - Override needs an explicit per-room manual price
  to mean anything, so applying it to "all" when nothing's selected never
  made sense. Scoped specifically to the `override` sub-type;
  Discount/Rent Free/Rates all keep the existing "empty = all" behavior,
  which is correct for them.
- **Rates sub-type: "Copy rate from term" and "Apply to term(s)" were
  genuinely swapped** - fixed by relabeling (not touching the underlying
  fields, so the calculation engine's behavior is completely unchanged):
  "Apply to term(s)" now sits above the single dropdown, "Copy rate from
  term" above the multi-select. Purely a labeling fix.
- **Promotion Period redesigned to match the artifact exactly** - pulled
  the actual source rather than approximating again: each lease term now
  has its own independent "Split" checkbox. Unchecked means the whole
  Rebate Amount is 100% End Lease and the Mid Lease % field doesn't even
  exist on screen; checking it reveals the field (defaulting to 50% the
  first time, never overwriting an already-set value) along with a live
  "(X% End)" hint - exactly the artifact's own behavior, including
  resetting to 0 (not just hiding) on uncheck, which is what the
  calculation engine already reads as "no split" internally.
- **Rates/Calculator page: the Rate Card Summary and Promotions panels
  now follow the selected Check-in date**, matching the artifact, instead
  of staying pinned to whichever card happens to be selected in Setup.
  Verified directly: selecting a Check-in date that resolves to a
  *different* card than the Setup-selected one correctly swaps both
  panels to match it; with no Check-in chosen yet, it correctly falls
  back to the Setup-selected card rather than showing nothing.

## Hot Room override, and a careful look at the "Confirmed" bug (latest pass)

- **Reservation "Confirmed" rows showing no detail - investigated, not a
  missing-code issue.** Jeremy shared the main dashboard's real
  `availability.js` to check against. Did a direct, careful comparison:
  `resolveRoomStatus` is byte-for-byte identical between the two files,
  and `mapOccupancyRoom`'s reservation-field extraction (`leaseStart`,
  `leaseEnd`, `resNo`, `guestName`, `nights`, all the same `reservation ?
  ... : null` gating on the same three statuses) is logically identical
  to this project's `mapRoom` - nothing was missed in the port. Floor
  still populates correctly for Confirmed rows because it's parsed from
  the room name independently of any reservation data; every other blank
  field is derived from `r.reservation`, which strongly suggests YSuite's
  real API returns a `reservation` object that's *present* (so the status
  logic correctly treats the room as booked) but *empty or missing most
  fields* specifically for Confirmed (not-yet-arrived) bookings, as
  opposed to Arrived/Unconfirmed ones. That's a genuine data
  characteristic to confirm against a real payload, not something more
  code can fix blind - flagged rather than guessed at.
- **Hot Room column, built to spec**: a toggle + number field per room
  type row, to the left of the 3 lease-term columns in Setup > Rate Cards
  > Room Types. Stored on the property (`property.hotRooms`), not per
  rate card, since a room type's real available count in Agent is a
  property-wide concept - every card's Room Types table reads and writes
  the same shared value for a given type. The number field always
  overrides Agent's computed Available count, completely independent of
  the toggle; the toggle only controls whether 🔥 shows next to the room
  type's name. Verified directly against the exact reported example:
  toggle off with a quantity set still overrides the count with no fire
  icon; toggling on with the same quantity keeps the override and adds
  the icon; clearing the override entirely falls back to the real
  computed count. The footer's "All room types" total was also updated to
  sum the (possibly overridden) per-row values, so it never visibly
  disagrees with what's shown above it.
- **Floor Plan Edit/Copy mapping buttons - deferred at Jeremy's request**,
  to be picked up in a dedicated pass later. Noted for then: Edit should
  support all three adjustments (move a point, add a point mid-edge, drag
  the whole shape) from day one.

## Agent, Floor Plan, and Promotion tab fixes; a real upload-timeout bug found (latest pass)

- **Agent tab**: the inline "N unit gender conflict" warning is gone from
  the gender-split line, replaced with its own button - "N Unit ⚠" - to
  the left of "N Mismatch" in the topbar, same click-to-filter-Reservation
  behavior as that one, just checking a different thing (two bedrooms in
  the same shared unit disagreeing with each other, not one room's own
  Title/Gender data). Weekly Rate and Available are now center-aligned
  (Room Type stays left) - including the flex container inside the
  Available cell, which needed its own `justify-content` fix since
  `text-align` alone doesn't center flex children.
- **Floor Plan viewer**: fixed the dimming bug where the *selected* area
  still looked dimmed - the spotlight highlight was a heavy 40%-opacity
  colored fill drawn on top of the brightened cutout, which read as
  "still tinted" even though it was technically brighter than the
  surrounding overlay. Reduced to a thin outline so the selected area
  reads as genuinely clear. Also: every *other* room's mapping is now
  hidden entirely (not just dimmed) whenever something's selected or a
  filter is narrowing the room list - verified directly against the exact
  reported example (filtering Floor 2 to "confirmed" now shows only
  02.03/02.04's mapping, nothing else). Facilities (lifts, stairs) stay
  visible regardless, as orientation landmarks rather than something
  being filtered.
- **Floor Plan upload - real bug, found and fixed.** "Image successfully
  uploaded but an error message is shown" traced back to the automatic
  grouping check added a few passes ago: it re-scanned *every* stored
  floor image sequentially on every single upload, which gets slower as a
  property accumulates floors and can plausibly exceed a function's
  execution time - explaining exactly why the image itself had already
  saved successfully by the time the client saw a failed request. Fixed
  by comparing only the newly-uploaded image against what's already
  stored, in parallel rather than one at a time - functionally equivalent
  for grouping correctness (any floor uploaded from now on still gets
  correctly matched against everything already there), just not doing
  needless repeat work on every single upload. Verified the speed
  difference directly with simulated storage latency: ~9ms with 20
  existing floors, versus what would have been 100ms+ sequentially.
- **Setup > Promotions**: Start/End Date now sit on the same row as Type/
  Sub-Type/Name (same field width as before, just relocated). Room Types
  are a single row of toggleable pills using each type's short name
  (falls back to the full name if no short name is set) instead of a
  checkbox list of full names. Promotion Period's Amount/Mid Lease %
  fields, and Property Information's Rates row (Currency/Rate Type/
  Security Deposit/Bond/Advance Rent), now have their labels above the
  field instead of beside it - also cleaned up a genuinely duplicated
  `.floor-range-row` CSS rule found while making this change (the second,
  more complete definition was silently overriding the first on scoping
  grounds - harmless as long as they always matched, but worth removing
  either way, before working on it further to update the layout, so
  there is only one definition to touch, not two that could invisibly
  drift apart).
- **Not yet done, still waiting on clarification**: the Reservation
  "Confirmed" rows-show-no-detail report (code review didn't turn up a
  status-based condition anywhere - may be a real difference in how
  YSuite structures a Confirmed booking's reservation data versus an
  Arrived one), the Setup > Rate Cards "Hot Room" column, and the Setup >
  Floor Plan Edit/Copy mapping buttons (a substantial new feature needing
  proper pointer-drag handling this app doesn't have yet).

## Real data-loss bug in the auto-save success path, fixed (latest pass)

Root cause of "clicking Add on a Check-in/Check-out rule wipes all my
lease terms, room prices, and utilities, and the rule itself doesn't even
get added": a successful auto-save was doing `state.rates = res.body` -
replacing the *entire* object tree (property, list, activeIndex) with a
brand-new one parsed fresh from the server's JSON response, without
calling `render()` (deliberately, to avoid the earlier heartbeat-style
bug where a background update wipes in-progress typing).

That protection created a different problem: Rate Cards' `rcActiveCard` (and
anything else an event handler had already captured a reference to) was
bound to the *old* object tree. The moment any single field's auto-save
succeeded, `state.rates.list` silently became a *different* array holding
*different* card objects - but `rcActiveCard` kept pointing at the old,
now-detached one. Every edit after that point (typing into another field,
or clicking "+ Add" on an availability rule) mutated that orphaned object
instead of the one actually driving the screen and the next save -
invisible until the next full re-render, at which point it looked exactly
like everything had reverted to empty, and the just-added rule was simply
never there to begin with.

Fixed by no longer replacing the object tree on a successful save at all -
only `_version` and `lock` get updated in place, since those are the only
two things that actually change on success (the server just echoes back
exactly what was sent otherwise). Every existing reference - `rcActiveCard`
included - now stays valid indefinitely, since `.property`/`.list`/
`.activeIndex` are never swapped out from under it. The 409-conflict path
is intentionally different and unchanged: there the server's state
genuinely differs from what was sent, so replacing the tree *and*
re-rendering immediately to rebind everything against it is correct, not
a repeat of this bug.

Verified by reproducing the exact mechanism directly: captured a reference
to a card the same way `rcActiveCard` does, ran a mocked successful
save, confirmed the reference still points at the exact same object
afterward (not a different one with equal-looking content), then mutated
it (pushing a new availability rule, exactly like clicking "+ Add" does)
and confirmed the rule, the utilities value, and the room price are all
correctly still there on `state.rates.list[0]` - not lost to an orphaned
copy.

## Property reset now clears every page's filter state too, not just the data (latest pass)

Real bug: after changing Property ID and syncing the new property, the
stat cards (built straight from `state.rooms`) showed correct numbers, but
the Reservation table below said "No rooms match these filters" with every
*visible* filter field showing default/blank. Root cause: the property
reset wiped Rate Cards, Room Information, and Floor Plan data, but never
touched each page's own filter/selection state - so a `quickFilter` left
over from before the reset (e.g. "departingToday", from clicking that stat
card at some point) silently survived the reset and kept filtering the
*new* property's rooms against it. Because a quickFilter is driven by a
highlighted stat card rather than anything in the plain search/type/
status/date filter row, there was no visible sign a filter was even
active - it just looked like the whole table had vanished for no reason.

Fixed by having the reset also clear: Reservation's full filter state
(search, type, status, dates, quickFilter, sort - back to its defaults),
the Agent view's own date range, and the Calculator page's check-in/
check-out/room-type/compare selections. These are all page-level UI state
that can meaningfully reference the *old* property (an old room type, an
old date range, an old quickFilter) and were never in scope for the
original reset, which only wiped the underlying property data. Verified
by reproducing the exact reported shape directly: armed a stale
`quickFilter: "departingToday"` beforehand, ran the reset, then simulated
a fresh sync bringing in 241 new rooms none of which are departing within
7 days - confirmed the table now shows the real rooms instead of the
empty-filter message, and that every other piece of stale state (date
range, calculator selections, Floor Plan filters) gets cleared alongside
it.

## A real timezone bug, and two different "mismatch" concepts clarified (latest pass)

- **Real bug found and fixed: "Arriving Today" showing 0 for a room whose
  lease starts today.** Root cause was `todayISO()` computing "today" via
  `.toISOString()`, which converts through UTC first - for anyone whose
  local time is ahead of UTC, that silently reads as *yesterday* well into
  the morning (exactly matching Jeremy's report: leaseStart is today's
  date, "Arriving Today" shows 0, but "+7 Days" correctly shows 1, since
  the date still falls inside the 7-day window even when the exact
  "today" string comparison misses by one day). Fixed to build the date
  from local `getFullYear()`/`getMonth()`/`getDate()` instead, so "today"
  matches the person's own calendar day rather than the server's/UTC's.
  This function is used everywhere "today" matters (Agent, Reservation,
  Floor Plan filters), so the fix isn't limited to the one stat card -
  confirmed no other spot computes "now" through `.toISOString()` the same
  way. Verified structurally (the fix uses local, not UTC, getters) rather
  than by chasing this exact environment's own system timezone, which
  isn't the same thing as Jeremy's.
- **Two genuinely different things were both being called "mismatch"** in
  the Agent view, which is what made the 2 Bedroom Apartment numbers look
  wrong when they weren't: **"unit gender conflict"** (previously worded
  "N mismatched (unit)") is about two bedrooms in the *same* shared
  apartment currently showing different genders from each other - a real,
  pre-existing check unrelated to any one room's own data - versus
  **"Title/Gender mismatch"**, which is the same per-room Title-vs-Gender
  disagreement the topbar's "N Mismatch" button counts. Renamed the unit-
  level one so the wording can't collide with the other, and added a
  `title` tooltip on each explaining exactly what it means. Also worth
  knowing: the Title/Gender line in Agent's own per-type breakdown only
  ever shows up for *shared* room types, since the gender-split display
  itself only exists for those - a mismatch on a single/unshared room
  (like Jeremy's actual case, a Studio Premium unit) will never appear in
  Agent's type-by-type view, only in the topbar button and the Reservation
  list it filters to. Verified this distinction directly against a
  constructed case matching the reported shape: a 2BR unit with a real
  cross-bedroom gender conflict, and a separate, unrelated single Studio
  Premium room with its own Title/Gender mismatch - each counted under the
  correct label, with zero bleed between the two.

## Reservation metric fixes, Agent date dropdown fixes (latest pass)

- **Stat card values were dark-on-dark** - `.stat-num` had no explicit
  color at all (unlike `.filter-stat .num`, which did), so it fell back to
  something unreadable against the panel background. Fixed with an
  explicit `color: var(--ink)`.
- **Arriving/Departing today now show two numbers**: "Arriving Today / +7
  Days" and "Departing today / +7 Days", each as "N / M" - N is the exact
  count for today, M is the cumulative count from today through 7 days
  out (inclusive). Clicking either filters Reservation to that same
  7-day window (not just today) and sorts by the relevant date newest
  first (furthest-out date at the top) - both the filter and the default
  sort reset cleanly if a different stat card (or Total rooms) is clicked
  afterward, same "replace, don't stack" pattern as the other cards.
  Added `leaseStart`/`leaseEnd` as valid sort keys to support this.
- **Agent view's Start/End date dropdowns were unstyled** - `.filter-field`
  only had CSS for `input[type="date"]`, never for `select`, so those two
  fields fell back to the browser's bare default appearance while every
  other dropdown in the app had its own styling. Fixed by extending the
  same rule to `select` too.
- **End date is now always a dropdown**, sourced from the union of every
  rate card's own Check-out rules (not scoped to whichever one card the
  selected Start date happens to resolve to, the way the Calculator
  page's check-out needs to be for its own per-room price calculation) -
  never falls back to a native date picker the way it used to when no
  single resolved card had check-out rules.
- **Start and End date now default to the earliest available option** on
  load, instead of sitting blank waiting to be picked.

## Per-type High/Low, nav styling fixes, and a Title/Gender mismatch button (latest pass)

- **A base type only splits into High/Low if it actually needs to** - not
  just "splitting is on for the property" as a blanket rule. Per Jeremy's
  exact example: Ensuite Premium only existing on floors 2 and 4, both
  below a `highFloorFrom` of 11, now correctly stays a single "Ensuite
  Premium" row with no split, while a type that genuinely has rooms on
  both sides (like Studio Premium spanning floor 3 and floor 12) still
  splits normally. `computeTierPresence` checks each base type's actual
  synced rooms for High-tier and Low-tier presence; `typeShouldSplit`
  requires both to be present. Recomputed from `state.rooms` on every
  `render()` (`TIER_PRESENCE`, alongside `BASE_TYPES`), so a resync
  updates this the same way it updates everything else room-type-related.
  Tested directly against the exact scenario (low-only type doesn't
  split, high-only type doesn't split either, a genuinely-spanning type
  still does, and turning the property-wide split off makes everything
  unsplit regardless of presence).
- **Nav tab "curve" fixed** - it wasn't actually curved geometry, it was
  the global `button { border-radius: 8px }` rule leaking through on the
  underline tabs (`.setup-tab`, `.top-nav-tab`), which never explicitly
  reset it. The straight `border-bottom` line was rendering with rounded
  corners at each end. Fixed with `border-radius: 0` on both.
- **Rate Card selector reverted back to the pill/chip design** (rounded,
  bordered, filled-teal active state) - my earlier change to match it to
  the underline-tab style was a mistake; reverted to match the actual
  reference design exactly, keeping the two-click "Confirm ×" delete
  behavior from a previous pass, just restyled to fit the pill shape
  (a small rounded badge) instead of underlined text.
- **New "N Mismatch" button**, to the left of Sync rooms in the shared
  topbar (so it's visible on every main page). Reuses the existing
  `effectiveGender` Title+Gender logic exactly as already built - Title
  is converted to male/female first (Mrs/Ms/Miss → female, Mr/Mr. → male),
  and a mismatch is only flagged when both Title and Gender resolve to an
  actual value and they disagree; either one being blank never triggers
  it. Tested against all six of Jeremy's exact examples. The button shows
  the live count across every synced room, is disabled at zero, and
  clicking it jumps to Reservation with every other filter cleared and a
  new `quickFilter: "titleGenderMismatch"` applied - same "replace, don't
  stack" pattern the existing stat cards already use.

## Floor Plan viewer: spotlight dimming (latest pass)

Selecting a mapped room (clicking it in the room list, or landing on it via
an active filter) now dims the rest of the floor plan image so the
selected area stands out clearly, rather than just outlining it on an
otherwise-unchanged image.

- Implemented as a dark overlay (`.fp-dim-overlay`) with a CSS
  `mask-image` - a dynamically-built inline SVG data URI whose mask is
  white everywhere (dark overlay fully visible) except black cutout
  polygons at the currently-highlighted room(s)' exact hotspot shape
  (fully transparent there, so the bright original image shows through
  cleanly - not just a colored shape drawn on top of a dimmed image).
- Works for both cases asked for: a single clicked room (`spotlightRoom`
  takes priority), and multiple rooms at once when a filter is actively
  narrowing the room list (every currently-matching room's hotspot gets
  cut out, not just one). Nothing selected and no filter active means no
  overlay at all - unchanged from before.
- `renderFpHotspotSvg` now takes an array of highlighted names instead of
  a single one, so every matching room gets the same accent-highlighted
  outline treatment together, not just the first.
- Tested directly: the decoded mask SVG for a single-room selection has
  exactly one black cutout at that room's own coordinates; for a
  multi-room filter match it has one cutout per matching room; a room
  that matches a filter but has no mapped hotspot at all is correctly
  left out rather than causing an error.

## Test connection cooldown countdown (latest pass)

Test Connection shares its rate limit with the Sync rooms button (both hit
`/api/availability`'s POST, both subject to the same 2-minute server-side
cooldown) - the button just wasn't showing that. Fixed:

- The button is now disabled and shows a live "Try again in 1m 15s"
  countdown, ticking down every second, whenever `state.nextSyncAllowedAt`
  is still in the future.
- Also picked up a real gap while in there: a 429 response's own
  `nextSyncAllowedAt` wasn't being read on the failure path at all (only
  on success) - so the button's cooldown could be stale relative to what
  the server actually enforces. Now read on both.
- The live tick is a direct, targeted DOM update (`document.getElementById
  ("test-btn")`, set `.textContent`/`.disabled`), never a full `render()`
  - this runs on a `setInterval` completely disconnected from anything the
  person is doing, so it follows the same rule the presence-lock heartbeat
  fix established a while back: a background timer must never call
  `render()`, or it risks wiping out a value mid-typed in some unrelated
  field. Self-cleans if the button leaves the page (navigating away from
  Property Information) rather than continuing to tick in the background.
  Tested directly against a mock button: ticks correctly, re-enables and
  resets its label the instant the cooldown expires, and the timer clears
  itself afterward rather than continuing to run.

## Room types are now dynamic, and changing Property ID resets Setup (latest pass)

Two real correctness gaps, both from testing against a second property with
an entirely different room list - both confirmed with Jeremy before
implementing, since either one built wrong would've meant redoing it again.

- **Floor Plan "detect shared floor plans" button removed - fully
  automatic instead.** Every image upload now triggers a complete
  byte-for-byte rescan across *all* currently-stored floor images (not
  just the one just uploaded against the others), so grouping is always
  current with zero manual steps, including retroactively fixing floors
  uploaded before another matching one arrives. Verified directly: floor 5
  uploaded alone, then floor 6 uploaded separately with the same bytes -
  floor 5's own grouping updates automatically even though it was never
  re-touched.
- **Room types are no longer hardcoded.** `TIERED_BASE_TYPES`/
  `SINGLE_BASE_TYPES` (Studio Premium, Studio Deluxe, Ensuite Premium, 2
  Bedroom Apartment - Jeremy's original property's actual types) are gone
  entirely, replaced by `BASE_TYPES`, computed fresh on every `render()`
  from whatever `state.rooms` last returned from a real sync. Per Jeremy's
  confirmation: every base type now tier-splits uniformly when "High Floor
  From" is set (no more per-type "doesn't split" exception), Setup's Room
  Information/Rate Cards/Promotions tabs are gated behind "sync at least
  once first" (they show a plain "Sync required" notice until then, rather
  than nothing to configure), and a later resync that adds or drops a room
  type updates everything downstream automatically - Setup included, not
  just Agent/Reservation. Verified against a synthetic "different
  property" sync (Studio Grand, 2 Bedroom Standard, etc.) end-to-end: those
  names now drive every tab correctly, and the old hardcoded names don't
  appear anywhere.
- **Changing Property ID now resets the whole property's Setup**, per
  Jeremy: a different property has an entirely different room list, rate
  cards, floor plan - none of the old configuration means anything for it.
  Uses the same two-click confirm pattern as everywhere else, extended
  here to a text field rather than a delete button: typing a new Property
  ID and blurring away arms a warning banner naming exactly what gets
  wiped (Room Information, every Rate Card and Promotion, every Floor Plan
  image and mapping) with **Confirm** and **Cancel** buttons - nothing
  happens until Confirm is actually clicked. Per Jeremy: full wipe, no
  backup, no per-property-ID history kept. "High Floor From" resets too
  (a new property needs to reconfigure its own floor split from scratch);
  Property Name, Short Name, Currency, Rate Type, and the deposit/bond/
  advance figures are left untouched, since none of those are tied to
  which specific property's data is loaded. This is a genuine wipe across
  three separate storage locations - `rates.js` (property config, done via
  the existing save path), plus two new backend actions
  (`action: "resetAll"`) added specifically for this: `floorplan.js`
  (hotspots/facilities/floor-groups) and `floorplan-image.js` (deletes
  every stored floor image outright, not just clearing references).
  `rates-media.js` got the same `resetAll` treatment for room photos/
  videos, so nothing orphaned is left behind in storage either. Tested the
  exact mutation logic directly: everything property-specific wiped,
  everything else (name, currency, rate type, deposit figures) verified
  byte-for-byte unchanged.

## Large batch: Agent rework, Property Info simplification, auto-calc, and a real Floor Plan fix (latest pass)

- **Numeric fields in Setup are blank by default, not pre-filled "0"** — a
  new `numOrEmpty` helper, applied everywhere 0 means "nothing entered
  yet" (deposit/bond/advance, utilities, prices, promo amounts/discounts).
  Deliberately *not* applied to `minNights`, where 0 is a real, meaningful
  value (a term can legitimately start at 0 nights).
- **Property Information: "High Floor From" replaces the old 4-field
  High/Low range**, plus a new **Short Name** field. One number now
  decides the whole split: floors below it are Low, that floor and above
  are High (unbounded - no separate "total floors" needed), and 0/blank
  means the property doesn't split by floor at all. This is a real
  architecture change, not just a UI change: `DISPLAY_TYPES` went from a
  fixed constant to something recomputed on every `render()` from the
  current property config, so the whole app's room-type rows (Setup, the
  Agent table, the Calculator's room dropdowns, Rate Cards' rows) follow
  automatically depending on whether the split is on. A one-time migration
  derives `highFloorFrom` from the old `highFloorMin` on first load, so an
  existing real config (like `highFloorMin: 11`) doesn't silently reset.
  Tested directly: split vs. unsplit `DISPLAY_TYPES`, `resolveTier` at the
  boundary floor and beyond, the migration itself, and a stale-selection
  guard on the Calculator page (switching the split off shouldn't leave a
  now-nonexistent room type silently selected).
- **Availability Simulator (Calculator page): Calculate button removed.**
  Results now compute fresh on every render straight from whatever's
  currently selected - nothing cached, nothing that can go stale. Check-
  in, check-out, and room type all start blank; whichever of the 3 is
  still missing shows as a named prompt ("Select a check-out date and a
  room type to see pricing.") instead of an empty card. Compare mode's
  second card does the exact same thing independently - it's possible to
  have a real result on the left and a "select a room type to compare"
  prompt on the right at the same time.
- **Agent tab**: Check-in/Check-out are now dropdowns built from every
  rate card's actual availability rules (same approach as the Calculator
  page), not free date pickers. Added a **Weekly/Monthly Rate** column
  (label follows Property Information's Rate Type) immediately left of
  Available, showing the lowest of the 3 lease-term prices for whichever
  rate card the selected check-in date resolves to. Gender/Full Unit
  logic now combines **Title and Gender** rather than Gender alone - Title
  takes priority when it maps to one (Mrs/Ms/Miss → Female, Mr/Mr. →
  Male), Gender is the fallback when Title doesn't say anything (no
  title, or one like Dr/Prof that isn't in the map) - and a genuine
  disagreement between the two (Title says Mr, Gender says Female) is
  surfaced as its own "Title/Gender mismatch" count rather than silently
  trusting one side. Kept separate from the pre-existing "mismatched"
  count, which is about two different bedrooms in one shared unit
  disagreeing with each other - a different problem from one room's own
  data disagreeing with itself.
- **Rate Cards / Promotions tabs restyled to match the actual artifact**,
  not just the spec doc this time - pulled its real CSS for the Lease
  Terms/Promotion Period blocks (a bottom-border divider style, not a
  bordered box), the compact right-aligned range inputs, the red warning
  banner, and the inline labeled Name/Utilities row. Promotions also
  picked up the artifact's exact two-click "Confirm ✕" delete (see below)
  and small uppercase field labels on Type/Sub-Type/Name.
- **Two-click "Confirm ✕" delete extended to Promotions**, same pattern as
  the Rate Card pill from last pass, reusing the same document-level
  "click elsewhere cancels" listener rather than duplicating it.
- **Floor Plan cascade bug - the real fix.** Re-diagnosed rather than
  re-explaining the same fix: the propagation logic itself was already
  correct, and so was last pass's upload-time content-matching. The actual
  gap is that the upload-time fix only ever looks at the image being
  uploaded *right now* - it never goes back and checks images that were
  already sitting in storage before that fix existed, which is exactly
  Jeremy's situation with floors 5-8. Added a **"Detect shared floor
  plans" button** in Setup > Floor Plan that does a full byte-for-byte
  rescan across every stored floor image and rebuilds the grouping from
  scratch (not a merge - a clean recompute), independent of upload order
  or timing. Verified end-to-end against the exact reported scenario:
  floors 5-8 already stuck with no group recorded → rescan → map 05.01
  YSMG on floor 5 → 06.01, 07.01, 08.01 all correctly picked it up.


- **Rate Card pill row restyled from rounded chips to simple underline
  tabs**, matching the top nav bar and the Setup tab bar exactly (same
  colors, same border-bottom-on-active treatment) rather than the old
  pill/chip look.
- **Two-click "Confirm ×" delete, no `window.confirm()` dialog** - ported
  directly from the Lease Rate Simulator artifact's own pattern. First
  click on a card's × arms it (turns red, reads "Confirm ×"); a second
  click on the SAME × actually deletes; clicking anywhere else - a
  different card, a different ×, empty space - disarms it instead,
  handled by one document-level click listener rather than per-button
  logic. Also picked up the artifact's own safety rule while I was in
  there: the × doesn't render at all when only one rate card is left, so
  there's always at least one.
- **Floor Plan hotspot outline fix applied to the public viewer too**, not
  just the Setup editor - both share the same `.fp-hotspot-poly` CSS, but
  the viewer's own polygon-building function hadn't picked up the
  `vector-effect="non-scaling-stroke"` attribute from the editor's fix
  last pass. Fixed so both now render a true, fixed 1.5px outline
  regardless of how large the floor plan image itself is displayed.

## Auto-save, Title/Gender, and Floor Plan fixes (latest pass)

- **No more "Save changes" button anywhere in Setup.** Every field now
  saves itself on change - debounced (500ms) and single-flight, so a fast
  run of edits (tabbing through the Rate Cards pricing grid's 21 cells,
  say) coalesces into one save instead of firing one request per field.
  A change that arrives while a save is already in flight gets queued and
  sent as its own follow-up right after, rather than racing it or being
  silently dropped - verified this directly: 4 rapid calls collapse into 1
  network request, and a call during an in-flight save correctly becomes
  a 2nd request with the right (non-stale) version rather than either
  request winning by chance. A real version conflict (someone else saved
  in between) still forces a full page refresh with an error banner,
  since at that point state.rates has been wholesale replaced by the
  server's current truth. A *successful* save deliberately does **not**
  trigger a full re-render - only the presence-lock banner updates,
  surgically, the same way the heartbeat fix works - specifically so this
  doesn't reintroduce the typed-value-disappears bug from earlier in a new
  form.
- **Title and Gender now come from real data**, not a placeholder. Both
  are guest/reservation attributes (present only while a room has an
  active booking - null for Available/Unavailable, matching the "leave
  gender blank on a fully vacant shared unit" assumption from way earlier)
  rather than a persistent per-room designation - confirmed this by
  reading the main Room Availability Dashboard's real `availability.js`,
  which Jeremy shared. `lib/room-mapper.js`'s old `normalizeGender`
  (always null - gender wasn't in the JWT's scope) is replaced with
  `formatGender`, sourced from `reservation.gender`; `title` is new,
  sourced from `reservation.title`. Reservation view's expandable detail
  row now shows a "Title" field alongside "Gender" (labels match exactly
  what was asked for).
- **Promotions now add at the top of the list**, not the bottom.
- **Floor Plan**: hotspot outline stroke width and point-marker radius are
  both `2` now (previously 1.5 and 1.1). While actively tracing a new
  hotspot, every other already-mapped hotspot on that floor is now hidden
  entirely (not just the one being redrawn), so the image stays clean to
  click points on.
- **Floor Plan auto-mapping fix**: the real bug was that grouping only
  ever got recorded when multiple floors were uploaded in one batch (the
  "Applies to floor(s)" field defaults to just the current floor, so
  uploading the same file to each floor separately - the natural way to
  do it with one image file per group - never triggered it). Fixed by
  detecting byte-identical images across ALL currently stored floor
  images on every upload, regardless of whether they arrived together or
  separately, and folding matching floors into the same group
  retroactively. Verified directly: uploading the same file to floors
  9-15 one at a time now ends with all seven correctly grouped, while a
  genuinely different image stays its own group.

## Two bugs fixed this pass

1. **Real data-loss bug**: typed-but-not-yet-blurred values in any field
   would silently disappear roughly every 10 seconds while Setup was open.
   Cause: the presence-lock heartbeat (added for concurrent-edit handling)
   called the full `render()` on every tick regardless of what the user
   was doing — and `render()` replaces the entire page's `innerHTML`,
   discarding any DOM input value that hadn't yet fired its `change`
   event. Fixed by having the heartbeat update only the lock banner
   directly (`#lock-banner-slot`) instead of re-rendering anything else.
   Verified the fix leaves `state.rates.property` completely untouched
   when a heartbeat tick fires. This was the only periodic re-render
   anywhere in the app (confirmed by checking for every other
   `setInterval`), so this fix should be complete, not partial.
2. **Number input spin-button "scrollbar"**: the browser's default up/
   down arrows on every `type="number"` field (~20 across Setup) are now
   hidden globally via CSS. Also added a global `wheel` listener that
   blurs a focused number input before the page scrolls, since scrolling
   over a focused number field silently changes its value in most
   browsers even with the arrows hidden — that's a separate, real problem
   the arrows-only fix wouldn't have caught.

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
- High/Low is derived client-side from floor number, using the ranges set
  in the Setup console — it isn't in the YSuite payload at all. Configure a
  High Floor min (required) and max (optional, blank = "and above"), and a
  Low Floor min/max the same way.
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

1. **Room type name matching — now based on a real sync.** `roomType` is
   taken from `roomTypeName` (or `categoryId` as a fallback). Confirmed base
   types from a real sync: `Studio Premium`, `Studio Deluxe`,
   `Ensuite Premium`, `2 Bedroom Apartment`. High/Low is NOT part of the API
   — it's derived purely from floor number (Setup console) and applied to
   the first three; `Ensuite Premium` has no tier. Anything that doesn't
   match one of these four is excluded from the table and surfaced as
   "unmapped" rather than silently dropped — and a tiered-type room whose
   floor falls outside both configured ranges is excluded too, surfaced
   separately as "unclassified". Worth double-checking there isn't a real
   5th base type (a 3-bedroom category, say) that just hasn't shown up in a
   sync yet.
2. **Room name parsing.** Still built from two real examples
   (`"02.02 YSMG"` vs `"17.12.1"`/`"17.12.2"`). Shared-unit detection is
   fully empirical now (from the room name's dot-segment shape, not the
   type name), so it'll correctly catch a shared unit under any base type —
   but the parsing regex itself is still only as good as those two samples.
3. **Gender field.** Still unavailable from the API (JWT scope). Once it's
   added: is it reported per bedroom, and does YSuite already enforce "same
   gender per shared unit," or does that need client-side reconciliation?
   The aggregation already tolerates a mismatch between bedrooms in the
   same unit (flagged as "⚠ mismatched" in the UI) rather than silently
   picking one.
4. **No authentication on this deployment.** It's built for Jeremy's own
   use with no login. If this is ever shared more broadly, put it behind
   Netlify's site-wide password protection (or a real auth layer) first —
   the JWT and property ID are safe (env-only), but the sync trigger and
   cached data currently aren't gated at all.
