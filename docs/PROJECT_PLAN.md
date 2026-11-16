# The Next Dollar: Capital Allocation

Initial Project Plan

Version: Initial (G1), November 15, 2026. Owner: the student, as Executive Producer. This plan moves into Asana after G1, where owners, acceptance criteria and the full Risk Register will live.

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

## First tasks through the G2 and G3 review

Ordered by what unblocks what. The Needs column lists the tasks each one waits on.

| # | Task | Done when | Needs |
|---|---|---|---|
| 1 | Neighborhood data table in config: six neighborhoods (three existing, plus the West Village, the Financial District and Fifth Avenue) with rent and base customer mix, using the GDD 5.2 starting values | Values load from one config table; existing three rents unchanged; tests check every mix sums to 100 | None |
| 2 | Per-neighborhood customer mix in the engine | Customers at a stand are drawn from that neighborhood's mix; deterministic tests show the same seed gives the same customers, and two neighborhoods with the same seed give different mixes | 1 |
| 3 | Art and map entries for the three new neighborhoods | Each new neighborhood appears on the New York map and can be scouted and visited; student checks the visuals | 1 (can run beside 2) |
| 4 | Offline episodes to tune the starting values | Report shows each neighborhood's best price lands near the GDD's typical price, and higher rent goes with less price-sensitive crowds; changes recorded | 2 |
| 5 | Three engine-generated deals placed in Central Park, the West Village and the Financial District, each with its own seller persona: books, price and at most one weakness, at least one clean | Deterministic tests show every weakness is visible in the published books and the same seed gives the same deal | 2 |
| 6 | Template baseline pitch | Template never names the weakness and uses only book figures, under test | 5 |
| 7 | Seller pitch behind a server call, with the number check, weakness check and 6-second fallback to the template | Stub tests pass for every pitch failure mode in the Configuration Document; no live calls in CI | 5, 6 |
| 8 | Seller questions: up to three per deal, each answer checked, and questioning ends on a failed check or timeout | Stub tests pass for answer failures, including injection attempts and a fourth question | 7 |
| 9 | Books points to the missed line, or confirms the deal was clean, after a bought stand has run | Deterministic tests for one flawed and one clean deal | 5 |
| 10 | Board ranks by total value created, with value per day shown beside it | Tests on the score function and the board order | Can run beside 1 to 12 |
| 11 | Small live evaluation (student approves the spend first) | Report of false numbers, named catches, injection results, latency and cost over a fixed set of deals and questions | 8 |
| 12 | One external playtest of the deal loop: seller with questions against the template | Initial Playtest Log records book opens, questions asked, time per deal and bad deals refused, with observations kept apart from interpretation | 8 (11 helps) |
| 13 | Permanent account: decide the smallest enforceable version | Written decision, and a server check if time allows | Can run beside 1 to 12 |
| 14 | Plan and Risk Register moved into Asana right after G1 | Tasks and gate dates in Asana | None |
| 15 | First-playable recording by Nov 28, updated GDD and Configuration Document, and a production plan for G3 | Submitted by the student | 4, 11, 12, 13, 14 |

Tasks 1 to 4 add six real neighborhoods to the prototype (student decided). The student's mitigation for the added scope is precise specifications, such as the GDD 5.2 table, so agents can build in parallel.

If time runs short, cut in this order (student decided): 1. landlords (already cut), 2. seller questions (fall back to the single pitch), 3. the number of weakness types.
