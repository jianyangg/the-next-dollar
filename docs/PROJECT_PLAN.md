# The Next Dollar: Capital Allocation

Project Plan

Version: Revised (post-G1), November 22, 2026 (updated from Initial G1, November 15, 2026). Owner: the student, as Executive Producer. This plan moves into Asana after G1, where owners, acceptance criteria and the full Risk Register will live.

## Gate dates

| Date (2026) | Event | Status |
|---|---|---|
| Sun Nov 15, 11:59 p.m. | G1 Concept post due | Confirmed |
| Mon Nov 16 | G1 review in class | Confirmed |
| By Tue Nov 17 | G1 decision posted | Confirmed |
| Thu Nov 19, 11:59 p.m. | Two Braintrust replies due | Confirmed |
| By Mon Nov 23 | G1 graded feedback | Confirmed |
| Sat Nov 28 | First-playable recording due (for the combined G2 and G3 review) | Confirmed on CourseWorks, Nov 15 |
| Mon Nov 30 | G2 Prototype and G3 Production, one combined review | Confirmed |
| Wed Dec 2 | Alpha | Confirmed |
| Fri Dec 4 | Beta | Confirmed |
| Dec 2 to 5 | External release playtest, after Alpha and before the Gold recording | Confirmed |
| Sat Dec 5 | Gold recording due | Confirmed |
| Mon Dec 7 | G4 Final / Pre-Launch review | Confirmed |
| Sat Dec 12 | Draft AAR and showcase evidence due | Confirmed |
| Mon Dec 14 | G5 Retrospective / Closure review | Confirmed |
| Mon Dec 21, 7:10 to 9:00 p.m. New York time | Capstone presentation, at the normal class time | Confirmed by the instructor in CourseWorks General Discussion, Nov 2 (the syllabus still shows Dec 17 to 23) |

Gate work is due at the start of class unless a separate deadline is stated.

## Reboot strategy (student decided, Nov 22)

The earlier codebase's mechanics, UI, assets and flat map did not feel right. Rather than patching the old frontend or rewriting everything from scratch, the project follows a **clean presentation reboot** over the salvaged financial core:

- **Salvage (do not rewrite):** Pure TypeScript domain math (`ledger.ts`, `value.ts` and their tests).
- **Rebuild from zero:** Clean Vite + React + TypeScript project (`src/core/`, `src/world/`, `src/ui/`, `src/server/`) with a **2.5D walkable NYC world**, a **2.5D Manhattan overview map**, walkable seller stands down the block, in-world floating accounting toasts, a modern Books drawer, and the sealed-bid deal panel.
- **Visual style (locked, student decided Nov 22):** **Straight-On 3/4 JRPG HD-2D** (like *Dragon Quest III HD-2D* / *Octopath Traveler*) built in **Three.js**—axis-aligned rectangular Manhattan grid (no diagonal isometric), front-facing 3D buildings/curbs/walls with crisp `NearestFilter` pixel-art textures, upright chibi 2D pixel-art character & stand sprites, warm directional shadows, and subtle tilt-shift depth-of-field.

## 6-day sprint schedule (Nov 22 to Nov 28 first-playable)

| Day | Focus | Concrete deliverables |
|---|---|---|
| Days 1–2 (Nov 22–23) | Scaffold, salvage core & Central Park HD-2D vertical slice | Scaffold `src/core/`, `src/world/`, `src/ui/`, `src/server/` with Three.js HD-2D renderer; salvage `ledger.ts` + `value.ts`; add 6 neighborhoods, 6-stand cap and 30-day career; ship 1 playable Straight-On 3/4 HD-2D Central Park block (axis-aligned WASD/click-to-walk character, lemonade stand, customers, in-world accounting toasts) |
| Day 3 (Nov 24) | Deal loop, sealed bids & NYC expansion (no AI yet) | Walkable seller stand down the block; 3 seeded deals (books, asking price, hidden reservation price, 1–2 off-book facts); 1-shot sealed-bid deal panel; template pitch baseline; Books drawer + catch reveal; 2.5D Manhattan overview map + visual themes for the other 5 neighborhoods |
| Day 4 (Nov 25) | AI seller, validator & tuning | Cloudflare Worker → Vertex AI (`seller-prompt-v1`), shape/number checks, pitch-only volunteer guard, 1 silent retry + neutral fallback, 3-question cap, 6 s timeout, full stub tests, and offline balance tuning |
| Day 5 (Nov 26–27) | Live eval & external playtest | Approved small live Gemini eval (false numbers, pitch leaks, direct-question truthfulness, latency, cost) + 1–2 external playtests comparing AI seller + sealed bid against the template baseline |
| Day 6 (Sat Nov 28) | Polish & recording | Fix top playtest friction, verify `npm test` / CI, record first-playable video, and finalize G2/G3 handoff docs |

## First tasks through the G2 and G3 review

Ordered by what unblocks what. The Needs column lists the tasks each one waits on.

| # | Task | Done when | Needs |
|---|---|---|---|
| 1 | Scaffold fresh Three.js HD-2D project (`src/core/`, `src/world/`, `src/ui/`, `src/server/`) salvaging `ledger.ts` and `value.ts` | Fresh Vite + React + TS + Three.js repo builds cleanly; salvaged ledger and value tests pass; Straight-On 3/4 HD-2D camera & `NearestFilter` sprite pipeline verified | None |
| 2 | Neighborhood data table, per-neighborhood customer mixes & 6-stand cap: six neighborhoods (Central Park, Columbia, Broadway, West Village, Financial District, Fifth Avenue) with rent and base mix (GDD 5.2) | Values load from one config table; mixes sum to 100; deterministic tests show per-neighborhood customer draws; players can own up to 6 stands | 1 |
| 3 | Central Park 2.5D vertical slice: walkable character, lemonade stand, animated pedestrians and **in-world floating accounting toasts** (`Cash`, `Equipment`, `Profit` deltas) | Player walks smoothly (WASD / click) around a 2.5D Central Park corner, runs a stand, serves customers and sees live ledger diffs above the stand | 1, 2 |
| 4 | 2.5D Manhattan overview map & 5 remaining neighborhood block themes | All six neighborhoods appear on the 2.5D Manhattan overview map with real-inspired outlines and landmark pins, and transition into distinct 2.5D neighborhood blocks | 3 |
| 5 | Offline episodes to tune neighborhood rents and customer mixes | Report shows each neighborhood's best price lands near the GDD's typical price, and higher rent goes with less price-sensitive crowds; changes recorded | 2 |
| 6 | Three engine-generated deals (Central Park, West Village, Financial District) placed at walkable seller stands, with seller personas, books, asking price, hidden reservation price, on-book weakness and 1–2 structured off-book facts (at least one clean) | Deterministic tests show the same seed gives the same deal, reservation price is never exposed to the seller agent, and off-book facts are structured for validation | 2, 3 |
| 7 | One-shot sealed-bid resolution, deal panel UI & Books drawer (including post-purchase catch reveal) | Player walks to a seller's stand, inspects books, submits one bid (or walks); engine accepts when `bid >= reservationPrice` at the bid price; Books highlights any catch after the stand runs | 6 |
| 8 | Template baseline pitch | Template never volunteers off-book negatives and uses only book figures, under test | 6 |
| 9 | Seller pitch behind a server call (`seller-prompt-v1`), with shape/number checks, pitch-only volunteer guard, one silent retry and 6-second fallback to the template | Stub tests pass for every pitch failure mode in the Configuration Document; no live calls in CI | 6, 8 |
| 10 | Seller questions: up to three per deal, truthful when asked directly about off-book facts, with one silent retry and neutral fallback line that does not prematurely close remaining questions | Stub tests pass for answer failures, timeouts, injection attempts and a fourth question | 9 |
| 11 | Fixed 30-day career (no undo within a run) & leaderboard ranking by 30-day total value created (with value per day shown); drop server-owned permanent save enforcement | Career settles cleanly at day 30; board ranks by 30-day total value created; tests cover day-30 settlement and board order | 1 (can run in parallel) |
| 12 | Small live evaluation (student approves the spend first) | Report of false numbers, pitch leak rate, direct-question truthfulness (human sample), injection results, latency and cost over a fixed set of deals and questions | 10 |
| 13 | One external playtest of the deal loop: seller with questions + sealed bid against the template | Initial Playtest Log records book opens, questions asked, bid-to-ask ratios, time per deal and bad deals avoided or discounted, with observations kept apart from interpretation | 7, 10 (12 helps) |
| 14 | First-playable recording by Nov 28, updated GDD and Configuration Document, and a production plan for G3 | Submitted by the student | 4, 5, 7, 11, 12, 13 |

**Deferred to post-Nov 30 (Alpha / Beta):**
- Stacking multiple weaknesses of varying severity per deal.
- Deeper 2.5D neighborhood polish (extra ambient props, day-to-evening lighting transitions, stand visual upgrade tiers).
- Optional safe low-yield treasury option for idle cash (if playtests show holding cash needs an explicit yield).

If time runs short before Nov 28, cut in this order (student decided): 1. landlords (already cut), 2. bespoke props for the 5 secondary neighborhoods (reuse Central Park block kit with palette/signage swaps), 3. seller questions (fall back to single pitch + sealed bid), 4. number of distinct off-book fact types.
