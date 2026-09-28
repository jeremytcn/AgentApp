# Lease Rate Simulator — Engineering Handover

**Purpose:** This document specifies the data model, Setup Console UI structure, and calculation
logic of the Lease Rate Simulator prototype (`lease-calc.html`, V3), so it can be reimplemented
inside the real Y Suites application with identical behavior. The prototype is a single-file,
client-only HTML/JS artifact using `localStorage` for persistence — none of that persistence
mechanism needs to be preserved, but every calculation, validation rule, and console
tab/field layout described below should be.

Source file for reference: `lease-calc.html` (~4,270 lines, vanilla JS, no framework).

---

## 1. Top-level data shape

Everything persists as one object, `allRateCardsState`:

```js
allRateCardsState = {
  list: [ RateCard, RateCard, ... ],   // one or more rate cards
  activeIndex: 0,                       // which card is selected in the console pills
  property: GlobalProperty              // see §1.2 — shared across ALL rate cards
}
```

### 1.1 RateCard object

```js
RateCard = {
  id: 'card_xxxxxxxx',
  name: '',                // free text, shown as the pill label; max 30 chars in the UI
  utilities: 0,             // PER-CARD utilities rate (see §1.2 note — this moved off global)

  // Exactly 3 lease terms, fixed — not addable/removable in the UI.
  columns: [
    { label:'Short-Term', minNights:0,   maxNights:90  },
    { label:'Half-Year',  minNights:91,  maxNights:240 },
    { label:'Full-Year',  minNights:241, maxNights:null }  // null max = unbounded
  ],

  // Up to 8 room type slots, fixed — not addable/removable. A slot with a
  // blank name is treated as unused and never shown in any selector.
  rows: [
    { name:'Studio', prices:[2500, 2200, 2000] },  // prices[i] pairs with columns[i]
    ... up to 8 entries ...
  ],

  promotions: { list: [ Promotion, ... ] },   // per-card

  availability: AvailabilityField,            // Check-in rules, per-card
  checkOutAvailability: AvailabilityField     // Check-out rules, per-card
}
```

Lease-term name field is capped at 30 characters in the UI. Room name has no hard cap currently.

### 1.2 GlobalProperty object

Shared across **every** rate card — edited once, applies everywhere:

```js
GlobalProperty = {
  securityDeposit: 0,   // multiplier of the effective rate (weeks or months, per rateType)
  advanceRent: 0,       // same, multiplier
  bond: 0,              // same, multiplier — added alongside Security Deposit/Advance Rent
  currency: 'SGD',      // 'SGD' | 'HKD' | 'AUD' (symbol lookup table, extend as needed)
  rateType: 'Monthly',  // 'Weekly' | 'Monthly' — governs the whole app's period unit
  propertyId: '',
  lowFloorMin: 0, lowFloorMax: 0,
  highFloorMin: 0, highFloorMax: 0,     // Low/High floor ranges must not overlap (UI-warned, not blocked)
  roomMedia: {},         // keyed by room NAME (not id) — see §1.3
  roomShortNames: {}     // keyed by room NAME — see §1.3
}
```

**Important history:** `utilities` started as part of `GlobalProperty`, was moved to be
per-`RateCard`, and stayed there in the final version. Don't reintroduce a global utilities
value — it must vary per rate card (see §3.3, worked example).

### 1.3 Room-keyed global maps

`roomMedia` and `roomShortNames` are keyed by the room's **name string**, not an id, and are
**shared across every rate card** — if two different rate cards both have a room called
"Studio", they share the same images/videos/short-name entry. This was a deliberate design
choice (media/short-names describe a physical room type, which doesn't change by lease term
structure) — worth confirming this still makes sense in the real app's data model, since it
means renaming a room type in one card silently "orphans" its media under the old name.

```js
roomMedia = {
  'Studio': {
    images: [ 'data:image/...' , ... ],   // stored as data URIs in the prototype — replace with real asset storage
    videos: [
      { type:'link', url:'https://...', caption:'' },
      { type:'file', dataUrl:'data:video/...', caption:'', name:'x.mp4', size:12345, thumbnail:'data:image/...' }
    ]
  },
  ...
}
roomShortNames = { 'Studio': 'STU-HI', ... }   // max 20 chars in the UI
```

### 1.4 AvailabilityField object (Check-in / Check-out)

```js
AvailabilityField = {
  draft: { tier1:'single', startDate:'', endDate:'', weekday:'' },  // in-progress form state, not a saved rule
  rules: [ AvailabilityRule, ... ]
}
AvailabilityRule = {
  id: 'rule_xxxxxxxx',
  tier1: 'single' | 'range',   // inferred from whether endDate was filled in when the rule was added
  startDate: 'YYYY-MM-DD',
  endDate: 'YYYY-MM-DD' | '',  // only for tier1 === 'range'
  weekday: '' | '0'..'6'       // only for tier1 === 'range'; '' means every day in the range
}
```

**Semantics:** an empty `rules` array means "unrestricted" (any date is valid, rendered as a
free date picker). One or more rules means "only these dates are valid" (rendered as a
`<select>` populated with the union of every rule's matching dates). A date matches the field
if it matches **any** rule (rules are OR'd together, never AND'd).

Expanding a rule to concrete dates (`expandRule`):
- `tier1 === 'single'` → just `[startDate]`.
- `tier1 === 'range'`, no `weekday` → every date from `startDate` to `endDate` inclusive.
- `tier1 === 'range'`, `weekday` set → only the dates in that range falling on that weekday.

---

## 2. Setup Console structure

**Preserve this exact tab layout and global/per-card split — do not redesign it.**

Four tabs, in this order: **Property Information → Room Information → Rate Cards → Promotions**.

| Tab | Scope | Rate-card pill selector shown? |
|---|---|---|
| Property Information | Global (`GlobalProperty`) | No |
| Room Information | Global (keyed by room name) | No |
| Rate Cards | Per-card | Yes |
| Promotions | Per-card | Yes |

The rate-card pill row (pills for each card + "+ Add rate card") sits **only** above the Rate
Cards and Promotions tab content — never on the two global tabs, since there's no "which card"
to select there.

### 2.1 Property Information tab

One row of fields, in this order: **Property ID, High Floor (range), Low Floor (range),
Currency, Rates (Weekly/Monthly), Security Deposit, Bond, Advance Rent.**

- High/Low Floor are each a min–max number range. If the two ranges overlap, show a warning
  banner and red-outline the inputs — this is a soft warning, not a hard block.
- Security Deposit / Bond / Advance Rent are each "N weeks" or "N months" (label follows
  `rateType`), stored as a plain multiplier — see §3.5 for how they're applied.

### 2.2 Room Information tab

One block per **named** room slot (blank-named slots are skipped entirely), each showing:
- Room name (read-only heading) + an editable **Short Name** field beside it (max 20 chars,
  input width ~20 characters). Used only when comparing two rooms side-by-side in the
  calculator (§2.4) — the calculation cards themselves always show the full name regardless of
  compare mode; only the Rate Card summary table switches to short names during comparison.
- "+ Upload images" button, thumbnails with per-image delete.
- A "Videos" sub-section: one row with [video URL field] [+ Add pill] ["or"] [+ Upload video
  file pill] — all sized to fit their own content, not stretched. Below that, uploaded
  videos/links render as a wrapping grid (up to 6 per row), each card showing its
  thumbnail/link, a delete button, and its own caption field.

### 2.3 Rate Cards tab

Per rate card (selected via the pill row):
1. **Name** field (max 30 chars) — nothing else beside it (Utilities was tried here at one
   point and explicitly reverted; keep Utilities in a separate area — see note below).
2. **Check-in Availability** and **Check-out Availability** sections (see §2.5).
3. **Lease Terms** section: exactly 3 blocks side by side, each with a name input and a
   min–max night range (`to` blank = unbounded upper end). Overlapping night ranges across
   the 3 terms trigger a warning banner + red-outlined inputs (soft warning, not blocked).
4. **Room Types** section: exactly 8 blocks in a 4-per-row grid, each with a name input and 3
   price inputs (one per lease term). A blank name = unused slot, excluded everywhere else in
   the app.

**Where does per-card Utilities live?** It was placed, removed, and re-added to this tab
multiple times during the build; the final, confirmed state is: **Utilities is its own field
on the Rate Cards tab** (a plain number input, labeled "Utilities (Weekly)" or "(Monthly)"
depending on `rateType`), and it is **per-card** — different rate cards can and do have
different utilities values, and the calculator must use whichever rate card the check-in date
actually resolves to. Do not make it global. See the multi-card worked example in §3.3.

### 2.4 The calculator page itself (not the console)

Controls row, all in **one non-wrapping row** (horizontal scroll if too narrow, never wraps to
a second line): Check-in date, Check-out date, Room type, Compare room type (revealed by
toggling Compare), Calculate button, "+ Compare Rooms" pill pushed to the far right via
`margin-left:auto`.

- Check-in field: a free date picker if no rate card has any Check-in rules at all; otherwise
  a `<select>` populated with the **union** of every rate card's Check-in rules (so any date
  valid for *any* card is selectable) — see §3.2 for how the specific card is then resolved.
- Check-out field: re-built every time check-in changes, constrained to (a) that specific
  card's own Check-out rules and (b) strictly after the check-in date — so "check-out before
  check-in" is structurally unselectable rather than being caught as a validation error.
- Compare mode: shows a second calculation card for a second room type, using the **same**
  check-in/check-out dates. Only the Rate Card summary table's room names switch to short
  names while comparing; the calculation cards themselves always show full names.

### 2.5 Availability section UI (shared by Check-in and Check-out)

Two fields — **Start date**, **End date** — plus a **Day of week** selector, plus **+ Add**.
There is no separate "single vs range" type selector: leaving End date blank creates a
`tier1:'single'` rule; filling it in creates a `tier1:'range'` rule. Day of week is disabled
until an End date is entered (a single date has no weekday to filter). Multiple rules can be
added; saved rules render as pills — a plain date pill spans 1 of 10 grid columns, a range pill
spans 3 of 10 (so a range visually reads about 3× the width of a single date).

**Non-overlap rule:** a new Check-in rule is rejected (with an alert, and the input state
reverted) if its date span overlaps an existing Check-in rule on any **other** rate card —
this is what keeps "which card does this date belong to" unambiguous. **Check-out rules are
explicitly NOT subject to this check** — two different cards' check-out windows are allowed to
overlap freely, only check-in matters for card routing.

---

## 3. Calculation engine

This is the part that must be bit-for-bit reproduced. All amounts are integers/decimals in the
property's chosen currency; no currency conversion happens anywhere.

### 3.1 Date/night helpers

- `daysBetween(a, b)` = `round((b - a) / 86400000)` — nights between two UTC-midnight dates.
- `addMonths(date, m)`: adds calendar months; if the target month is shorter (e.g. Jan 31 + 1
  month), clamps to that month's last day (never rolls into the following month).
- `wholeMonthsBetween(start, end)`: the largest whole number of calendar months that can be
  added to `start` without passing `end` (uses `addMonths` under the hood, so month-length
  quirks are handled the same way).

### 3.2 Which rate card applies (multi-card routing)

Given the selected **check-in date only** (check-out plays no role in card selection):

1. If **no** rate card has any Check-in rules at all → always use `list[0]` (the first card).
   This is what makes the single-card case work unchanged.
2. Otherwise, find the first card among those **with** rules whose Check-in rules expand to
   include the selected date.
3. If none match, fall back to a card that has **zero** Check-in rules (a "catch-all" card),
   if one exists; otherwise fall back to `list[0]`.

```js
function findRateCardForCheckIn(checkInVal){
  const withRules = list.filter(rc => rc.availability.rules.length > 0);
  if(withRules.length === 0) return list[0];
  const matched = withRules.find(rc => rc.availability.rules.some(r => expandRule(r).includes(checkInVal)));
  if(matched) return matched;
  return list.find(rc => rc.availability.rules.length === 0) || list[0];
}
```

Room type list, prices, utilities, promotions, Check-out rules — **everything** downstream
uses whichever card this function returns, re-resolved every time the check-in date changes.

### 3.3 Which lease term applies

Purely a function of the **total night count** of the stay (`daysBetween(checkIn, checkOut)`),
matched against the **resolved rate card's own 3 `columns` ranges** (blank min → 0, blank max →
`Infinity`):

```js
matchedColIdx = columns.findIndex(c => totalNights >= (c.minNights ?? 0) && totalNights <= (c.maxNights ?? Infinity));
```

If no column's range covers that night count, show an error ("No lease term is set up for a
{N}-night stay") and don't calculate. (The night-range-overlap warning in the console is
separate and only warns about ranges overlapping each other — it doesn't prevent gaps.)

**Worked example — why utilities must be per-card:** Rate Card A has no Check-in rules (the
default/catch-all) and Utilities = 500. Rate Card B has a Check-in rule for all of March and
Utilities = 750. A booking with check-in March 10 resolves to Card B via §3.2, and must show
Utilities = 750 — not Card A's 500. A booking with check-in April 1 resolves to Card A and
shows 500. Both cards' room lists, prices, and promotions are similarly independent.

### 3.4 Proration — the core rent/utilities math

Two period types, selected globally by `GlobalProperty.rateType`:

**Monthly** (`calcMonthly(start, end, rate)`):
```
months = wholeMonthsBetween(start, end)
monthMark = addMonths(start, months)
remainderNights = daysBetween(monthMark, end)
periodAmount = rate * months
nightAmount = remainderNights > 0 ? prorate(rate, 30, remainderNights).amount : 0
total = periodAmount + nightAmount
```

**Weekly** (`calcWeekly(start, end, rate)`):
```
totalNights = daysBetween(start, end)
weeks = floor(totalNights / 7)
remainderNights = totalNights % 7
periodAmount = rate * weeks
nightAmount = remainderNights > 0 ? prorate(rate, 7, remainderNights).amount : 0
total = periodAmount + nightAmount
```

**`prorate(rate, fullPeriodNights, nights)`** — the exact remainder-distribution rule (must
match precisely, this is what makes partial-period math sum correctly):
```
floorRate   = floor(rate / fullPeriodNights)
remainder   = rate - floorRate * fullPeriodNights     // how many nights, across a FULL period, get floorRate+1
ceilCount   = min(remainder, nights)                   // how many of THESE nights get the +1
floorCount  = nights - ceilCount
amount      = ceilCount * (floorRate + 1) + floorCount * floorRate
```
This guarantees that prorating across a *full* period (`nights === fullPeriodNights`) reproduces
`rate` exactly, cent for cent, no matter how the division rounds.

Both functions return `{ total, periods, nights, periodAmount, nightAmount, steps, duration }` —
`periods`/`periodAmount`/`nights`/`nightAmount` are the fields the rest of the app consumes;
`steps`/`duration` were only for an earlier display format and can be ignored.

### 3.5 Weekly Rate Rebate (4 sub-types) — changes the rate/utilities actually charged

A promotion with `fieldType: 'weeklyRateRebate'` has one `subType`. **At most one such promo's
effect is applied per room+term**, resolved by scanning the room's active promotions **in list
order** and taking the **first** one whose sub-type resolves a value (see `resolveRateRebateValue`
below) — this is a "first match wins" model, not a stacking one. Utilities Discount (part of the
`discount` sub-type) is resolved completely independently via its own first-match scan, so a
"discount" promo can simultaneously win the rate slot and the utilities slot, or two different
promos could each win one slot.

An **empty `roomTypeNames`** on a promotion means "applies to all room types" (not "applies to
none") — this convention is used everywhere a promo has a room selector.

**`rates` sub-type** — copies one term's rate onto one or more *other* terms:
```js
fields: ratesSourceTerms:[termIdx,...]  // which term(s) get REPLACED (multi-select)
        ratesTargetTerm: termIdx        // which term's rate is COPIED FROM (single-select)
resolve(termIdx): ratesSourceTerms.includes(termIdx) ? roomPrices[ratesTargetTerm] : null
```

**`discount` sub-type** — flat $ off, recurring every period, for selected term(s):
```js
fields: discountTermIndices:[termIdx,...], discountAmount (Rate Discount), utilitiesDiscountAmount (Utilities Discount)
resolveRate(termIdx): discountTermIndices.includes(termIdx) ? roomPrices[termIdx] - discountAmount : null
resolveUtilities(termIdx): discountTermIndices.includes(termIdx) && utilitiesDiscountAmount>0 ? utilitiesDiscountAmount : null   // returns the deduction, not the new value
```

**`override` sub-type** — replace a room's rate outright, per room+term, manually typed:
```js
fields: roomOverrides: { roomName: [val|null, val|null, val|null] }  // null/blank = "no override for this term"
resolve(termIdx): roomOverrides[roomName]?.[termIdx] ?? null
```
The console pre-fills these inputs as **empty**, with the room's current rate shown only as a
placeholder hint — leaving a field blank means "unchanged", not "set to 0".

**`rentFree` sub-type** — a LUMP SUM discount, not baked into the per-period rate at all (see
§3.7). It shares `discountTermIndices`/`discountAmount`/`utilitiesDiscountAmount` with
`discount`, but the two numbers mean **"number of periods free"** (can be fractional, e.g. 3.5),
not a dollar amount.

**Effective values actually used downstream:**
```js
effectiveRateVal            = (rate-rebate resolved a value) ? that value : original roomPrices[termIdx]
effectiveUtilitiesPerPeriod = max(0, cardUtilities - (utilities-discount resolved amount, else 0))
```
`calcMonthly`/`calcWeekly` are then run on `effectiveRateVal` and `effectiveUtilitiesPerPeriod`
respectively — i.e. **the discount is baked into the period math itself**, not subtracted
afterward. This matters: it means the discount also affects the night-remainder proration
(via `prorate`), not just the whole-period amount.

**Display ("Workings") — do not double-count:** the original (gross) rate/utilities amounts are
also computed for display (`calcMonthly`/`calcWeekly` run again with the *original* rate), and
the **difference** between gross and effective is shown as a separate "(Rate Change)" /
"(Utilities Change)" line — purely informational. This delta must **never** be subtracted a
second time from the final total (it's already reflected in `effectiveRateVal`'s lower amount) —
this exact double-subtraction was a real bug in an earlier version and is worth a unit test in
the reimplementation.

### 3.6 Cross-promotion conflict validation (Weekly Rate Rebate only)

Two Weekly Rate Rebate promotions must not both control the same **(room, lease-term)**
combination while their date ranges overlap. "Touched combos" per sub-type:
- `rates`: every room in scope × every term in `ratesSourceTerms`.
- `discount` / `rentFree`: every room in scope × every term in `discountTermIndices`.
- `override`: every room+term where `roomOverrides[room][term]` is non-null.

("Every room in scope" = `roomTypeNames`, or literally every named room if that list is empty.)

Date ranges overlap if `promoA.start <= promoB.end && promoB.start <= promoA.end` (blank
start/end treated as `0000-01-01`/`9999-12-31`).

On conflict, the UI blocks the change and shows: `Unable to Create. {TermLabel} {RoomName} Rate
is already being applied in promo name: {OtherPromoName}` — and reverts the field that would
have created the conflict. This check re-runs on every relevant field edit (room selection,
term selection, override value, start/end date), not just at creation time.

### 3.7 Promotion Period — per-term lump sum, optional Mid/End Lease split

```js
fields: amounts[3]           // one $ amount PER LEASE TERM (parallel to columns)
        midLeasePercents[3]  // one % PER LEASE TERM — 0 means "100% End Lease"
```
Only `amounts[matchedColIdx]` / `midLeasePercents[matchedColIdx]` apply to a given booking —
the other two terms' amounts are irrelevant. Given the matched amount `amt` and percent `pct`:
```
midAmt = round(amt * pct / 100)
endAmt = amt - midAmt
```
Both are subtracted from the total as **lump sums**, unrelated to lease length. Displayed as
two separate lines when `midAmt > 0` (both a Mid Lease line and an End Lease line), or one line
when `pct === 0` (End Lease only). Each line's label includes a computed date:
```
Mid Lease date = checkIn + floor(totalNights / 2) days
End Lease date = checkOut − 28 days
```
UI note: the Mid Lease % input is capped at 99 (can't be set to 100 — there must always be an
"End Lease" component, however small).

### 3.8 Rent Free — per-term lump sum off the ORIGINAL rate, no split

```js
resolve(termIdx): discountTermIndices.includes(termIdx)
  ? { ratePeriods: discountAmount, utilPeriods: utilitiesDiscountAmount,
      rateAmount: originalRoomRate * discountAmount,          // NOT effectiveRateVal — the pre-rebate rate
      utilAmount: originalCardUtilities * utilitiesDiscountAmount }
  : null
```
Both `rateAmount` and `utilAmount` are lump sums subtracted from the total (grouped under one
"(Rent Free)" line with two sub-lines), exactly like Promotion Period — **no** Mid/End Lease
split option for this sub-type. Multiple active Rent Free promotions on the same booking all
apply (summed), unlike the single-winner model in §3.5.

### 3.9 Add Ons — zero calculation impact

`fieldType: 'addOn'` promotions carry only a free-text description (`addOnText`) and a
room/date scope. If active for the booking, their text is collected into a plain bulleted list
shown under the calculation (labeled "Add On") — no dollar amount, nothing added to any total.

### 3.10 Assembling the final total

```
grossRentResult        = calcMonthly/Weekly(start, end, originalRoomRate)          // for display only
rentResult              = calcMonthly/Weekly(start, end, effectiveRateVal)
grossUtilitiesResult    = calcMonthly/Weekly(start, end, originalCardUtilities)    // for display only, only if > 0
utilitiesResult         = calcMonthly/Weekly(start, end, effectiveUtilitiesPerPeriod) // only if > 0

preDeductionTotal = rentResult.total + (utilitiesResult ? utilitiesResult.total : 0)

promoDeduction = sum of:
  - every Rent Free entry's (rateAmount + utilAmount)
  - every Promotion Period entry's (midAmt + endAmt) for the matched term

finalTotal = max(0, preDeductionTotal - promoDeduction)
```

**Workings display order** (each a labeled section; a section is omitted entirely if it has
nothing to show):
1. **Accommodations** — gross rent, split into a "Rate ({periods} {Week/Month}s @ {rate}/period)"
   line and (if there's a remainder) a "Rate ({nights} Nights @ {perNightRate}/Night)" line.
2. **`{PromoName}` (Rate Change)** — only if a rate-rebate promo won the rate slot and the
   delta is non-zero. Same two-line shape, values are the *difference* (gross − effective),
   signed.
3. **Utilities** — same two-line shape as Accommodations, using the gross utilities rate. Only
   shown if the card's utilities is > 0.
4. **`{PromoName}` (Utilities Change)** — only if a discount promo won the utilities slot and
   the delta is non-zero.
5. **Rebate** — every Promotion Period line and every Rent Free line (with its rate/utilities
   sub-lines), in the order they were computed.

None of these Workings lines feed back into `finalTotal` — they're purely a rendering of numbers
already computed above; `finalTotal` must be computed independently and match their sum.

**"@ per-night rate" caveat:** `prorate()`'s remainder distribution can give different nights
within the same remainder-slice different per-night amounts (some nights floor, some floor+1).
The UI shows a single averaged "@ X/Night" figure (`nightAmount / nights`) for display — this is
cosmetic only; the actual `nightAmount` total used in every calculation is always exact.

### 3.11 Deposit, Bond, Advance Rent, and "Total Payable Today"

All three are simple multipliers of **`effectiveRateVal`** (the post-rebate rate, not the gross
rate) and the count is in the same unit as `rateType` (weeks or months):
```
depositAmount = effectiveRateVal * GlobalProperty.securityDeposit
bondAmount    = effectiveRateVal * GlobalProperty.bond
advanceAmount = effectiveRateVal * GlobalProperty.advanceRent
```
Displayed as **"Total Payable Today"** = `advanceAmount + bondAmount + depositAmount`, shown in
this order — Advance Rent, then Bond, then Security Deposit — as three plain lines beneath a
bold total line. **Any line whose amount is 0 is omitted entirely** (including the bold total
line's inputs — if all three are 0, only the "Total Payable Today: $0" line shows). This whole
block is hidden by default and revealed by clicking a "?" icon next to "Total Lease Amount"
(tooltip: "Total Payable Today").

---

## 4. Validation summary (all soft-warn or hard-block, as noted)

| Rule | Enforcement |
|---|---|
| Lease term night-ranges overlap each other (within one card) | Warn only (red outline + banner) |
| High Floor / Low Floor ranges overlap | Warn only |
| Check-in rule overlaps another rate card's Check-in rule | **Blocked** — alert + revert |
| Check-out rule overlaps another card's Check-out rule | Allowed — no check at all |
| Two Weekly Rate Rebate promos control the same room+term with overlapping dates | **Blocked** — alert + revert (see §3.6) |
| Check-out date before/equal to check-in | Structurally prevented (field only offers valid dates) rather than validated |
| Mid Lease % > 99 | Structurally prevented (input `max=99`, JS clamps on input) |

---

## 5. Known limitations to flag, not necessarily replicate

These are artifacts of the prototype being a single-file localStorage tool — call out to the
integration team but they don't need to be ported as "features":

- Images/videos are stored as base64 data URIs directly in `localStorage`, which has a small
  shared quota (~5–10MB total). The real app obviously needs real asset storage instead.
- Everything is single-user, single-browser (no backend, no multi-user concurrency).
- Fixed limits are hardcoded: **exactly 3** lease terms, **up to 8** room type slots per card.
  If the real product needs more/fewer of either, this is a structural change, not just config.
- No currency conversion — `currency` only changes the displayed symbol.
- The two-click "delete" confirmation pattern (click once to arm, click again within the same
  render to confirm, click anywhere else to cancel) exists because a real `window.confirm()`
  dialog is unreliable inside a sandboxed iframe — this constraint won't apply in the real app,
  a native confirm dialog (or whatever the app's design system uses for destructive actions) is
  fine there.

---

## 6. Open questions for Jeremy (please confirm or correct)

1. **Room media/short-name keyed by name, shared across cards** (§1.3) — confirm this is still
   the intended behavior in the real app, especially the "renaming a room silently orphans its
   media" edge case.
2. **Utilities is per-card** (§2.3, §3.3) — this went back and forth several times in this
   build; the worked example in §3.3 is the *final* confirmed behavior, but worth an explicit
   sign-off before the dev team builds against it.
3. **"First match wins" for Weekly Rate Rebate** (§3.5) — if two `discount`/`override`/`rates`
   promos could ever both apply to the same room+term, only the first (by list order) is used
   for the *rate*, and independently the first for *utilities*. Is list order (i.e., creation
   order, since new promos are inserted at the top) an acceptable/intentional tie-breaker, or
   should the real app make this explicitly inexpressible (i.e., keep the overlap-conflict
   block from §3.6 as the only guard, same as now)?
4. **Rent Free stacking** — unlike the other three sub-types, multiple active Rent Free promos
   all apply and sum together (§3.8). Confirm this asymmetry (one type stacks, three don't) is
   intentional.
5. Any real-world currency conversion / multi-currency property requirements, or is the
   single-currency-per-property model in §1.2 sufficient?
6. Any concurrency/multi-editor requirements for the Setup Console once it's backed by a real
   database instead of localStorage (e.g., two staff members editing the same rate card at once)?

If anything above doesn't match your intent, flag it now — this document is what the
integration team will build from.
