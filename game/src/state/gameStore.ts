import { type Actor, createActor, fromPromise } from 'xstate';
import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { applyBrewOutcome, type BrewKind, brewDifficulty, type BrewTier, type StirKey } from '../core/brewing';
import { advanceClock, type ClockSpeed, isClockPaused } from '../core/clock';
import { beatTheLine, closeDay as closeBooks, projectDay, startNextDay as advanceToNextDay } from '../core/dayEnd';
import { CENTRAL_PARK_DEAL, CENTRAL_PARK_DEAL_ID, resolveSealedBid, toPublicView } from '../core/deal';
import { type BrewCue, type BrewGameState, lemonadeBrew, pressGame, pressStirKey, stepGame } from '../core/minigames';
import { getNeighborhood, type NeighborhoodId } from '../core/neighborhoods';
import * as Purchases from '../core/purchases';
import { stepAwaySales } from '../core/awaySales';
import { getPlot, type PlotId, plotsIn, type PlotView, SELLER_PLOT_ID } from '../core/plots';
import { getPlotRent } from '../core/rent';
import { ledgerChips, type MoneyChip } from '../core/ledgerChips';
import { STARTER_NAME, type StarterItem, starterShortfall } from '../core/tutorial';
import { gameplayRandom } from '../core/runRandom';
import { applySale, applyWalkout, salePopLabel } from '../core/sales';
import { pourDurationMs } from '../core/standSales';
import { TUNING } from '../core/tuning';
import { dealMachine } from '../deal/dealMachine';
import { type DealView, toDealView } from '../deal/dealView';
import { createSellerClient, getRunId, type SellerClient } from '../deal/sellerClient';
import {
  createInitialState,
  type DayRecord,
  MANAGER_DAILY_WAGE,
  type SliceState,
  STALL_KIT_COST,
  WORKER_DAILY_WAGE,
} from '../core/sliceModel';
import { soundEngine } from '../audio/soundEngine';
import type { NearbyTarget } from '../world/CentralParkScene';
import type { FounderSpecies } from '../world/pixelArt';
import { anchorStore } from './anchorStore';
import { hasSeenIntro, markIntroSeen } from './introSeen';
import { getScene } from './sceneBridge';
import {
  cancelAllTimers,
  cancelBrewLoop,
  cancelServeLoop,
  scheduleTimeout,
  setBrewFrame,
  setServeFrame,
} from './timers';

/**
 * THE GAME STORE: one place that owns every piece of game state, and every function
 * that changes it.
 *
 * WHY A STORE (instead of `useState` inside App)
 *   1. Loops (clock, brewing, auto-serve) and keyboard handlers live OUTSIDE React's
 *      render cycle. With `useState` they needed "mirror refs": a second copy of each
 *      value, hand-updated so the loop could read the latest one. With a store the loop
 *      just calls `get()` and always sees the current value. No copies, no drift.
 *   2. Updates are SYNCHRONOUS. A React `setState` is applied later, so the old code
 *      decided "can I afford this?" on one copy of the state and then re-ran the rule on
 *      another. Here an action reads `get()`, decides, and writes with `set()` in one
 *      uninterrupted step, so two rapid clicks can never both spend the same $10.
 *   3. Components subscribe to just the slice they draw, so a clock tick does not
 *      re-render the shop panels.
 *
 * Data is grouped into logical slices (economy / day cycle / stand / ui / meta /
 * feedback / deal ui) as plain fields; all behaviour lives under `actions`. The pure
 * game RULES stay in `src/core` (no React, no store): actions just call a rule with
 * `get()` state and `set()` the result, then add the side effects (sound, toast).
 *
 * Middleware, innermost first:
 *   - `subscribeWithSelector` lets non-React code say "run this when THIS slice of
 *     state changes" (used to push state into the 3D scene; see connectScene.ts).
 *   - `devtools` shows every action by name in the Redux DevTools browser extension.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SalePop {
  id: number;
  text: string;
  combo: number;
  isPerfect?: boolean;
}

export type ActiveModal =
  | 'seller-stand'
  | 'market-stalls'
  | 'market-lemons'
  | 'market-pitchers'
  | 'plot-lease'
  | null;

/** The plain data of the game (everything except the functions). */
export interface GameData {
  // --- economy: the pure accounting model from core/sliceModel ---
  economy: SliceState;

  // --- day cycle ---
  /** 0 = 8:00 AM, 1 = 8:00 PM. */
  timeProgress: number;
  clockSpeed: ClockSpeed;
  /** The closing-bell scorecard; non-null while the end-of-day modal is showing. */
  eodRecord: DayRecord | null;
  /**
   * The 30-day career is over: the last day's receipt was closed and the final results
   * screen is showing. Nothing runs after this; the only way on is a new run.
   */
  runOver: boolean;

  // --- stand (what happens behind the counter) ---
  workingAtStand: boolean;
  /** Cups already brewed and waiting in the pitcher (never more than cupsInStock). */
  brewedCups: number;
  /** The running brew mini-game, or null. One immutable value from core/minigames. */
  brewGame: BrewGameState | null;
  /** Last challenge played, so the same one never repeats back-to-back. */
  lastBrewKind: BrewKind | null;
  /** True while the player holds Space / the thrust button (read by the brew loop). */
  spaceHeld: boolean;
  /** Brief screen-shake flag after a wrong key in Rapid Stir. */
  stirShake: boolean;
  combo: number;
  /** Bumps on every sale so the cash counter can replay its pulse animation. */
  cashPulseKey: number;
  /** 0..1 progress of the pour (core/standSales.ts pourDurationMs), or null when not pouring. */
  serveProgress: number | null;

  // --- ui ---
  /** The opening story cards are showing (first visit, or "Replay intro"). */
  introOpen: boolean;
  /**
   * False until the player confirms a founder for the first time. Before that the
   * founder picker cannot be dismissed (Esc / backdrop): there is no run behind it yet,
   * so closing it would drop the player into the world without having chosen anyone.
   */
  runStarted: boolean;
  /**
   * A subway ride in progress, or null. 'cover': the transition is closing over the
   * old district; the district is swapped while fully covered; 'reveal': it opens on
   * the new one. Input and the clock are paused for the whole ride.
   */
  travel: { to: NeighborhoodId; phase: 'cover' | 'reveal' } | null;
  founderModalOpen: boolean;
  mapOpen: boolean;
  booksOpen: boolean;
  activeModal: ActiveModal;
  tutorialActive: boolean;

  // --- meta ---
  founderSpecies: FounderSpecies;
  neighborhoodId: NeighborhoodId;
  /**
   * The plot the player last walked up to in this district (to lease, build, staff or
   * run it). Null until they pick one; cleared on every subway ride. The lease window
   * and the stand counter act on this plot.
   */
  activePlotId: PlotId | null;
  /**
   * Fractional cups each staffed stand has "earned" toward its next away sale
   * (core/awaySales.ts). Kept between clock ticks; cleared at the day close.
   */
  awayCarry: Record<PlotId, number>;
  /** Last non-market district, so "Back to <district>" knows where to return. */
  lastBusinessNeighborhood: NeighborhoodId;
  /** The district the player rode in from (null before the first ride): the map's Back. */
  previousNeighborhood: NeighborhoodId | null;
  muted: boolean;

  // --- feedback (floating text) and the id counters that name each item ---
  toasts: WorldNote[];
  salePops: SalePop[];
  nextToastId: number;
  nextPopId: number;
  nextReviewId: number;

  /**
   * The district title shown at the top of the screen after a subway ride
   * (ui/ArrivalTitle.tsx). `id` changes on every arrival so a quick second ride
   * restarts the title. Cleared by a timer.
   */
  arrival: { id: number; district: NeighborhoodId } | null;

  // --- seller deal (a render-ready view of the deal machine; null until first opened) ---
  deal: DealView | null;
}

export type ToastTone = 'positive' | 'neutral' | 'negative';
export type ToastAnchor = 'own-stand' | 'seller-stand';

/**
 * A note floating above a stand: a few words (`text`), the money that moved (`chips`,
 * computed by core/ledgerChips), or both. Never a sentence: the UI shows it large.
 */
export interface WorldNote {
  id: number;
  text: string | null;
  tone: ToastTone;
  anchor: ToastAnchor;
  chips: MoneyChip[];
}

export interface GameActions {
  // ui / meta
  toggleSound: () => void;
  toggleClockSpeed: () => void;
  pickFounder: (species: FounderSpecies) => void;
  openFounderModal: () => void;
  closeFounderModal: () => void;
  /** "Open My Stand" button: unlock audio, start music, close the founder picker. */
  startFromFounderModal: () => void;
  /** Close the opening story (last card, or skipped) and remember it was seen. */
  finishIntro: () => void;
  /** Show the opening story again (from the founder screen). */
  replayIntro: () => void;
  /** Dev panel only: forget the seller deal's state machine so the next visit starts fresh. */
  resetDealForDev: () => void;
  toggleMap: (opts?: { click?: boolean }) => void;
  closeMap: () => void;
  toggleBooks: (opts?: { click?: boolean }) => void;
  closeBooks: () => void;
  openModal: (modal: Exclude<ActiveModal, null>, opts?: { click?: boolean }) => void;
  closeModal: () => void;
  /** Walk away from the seller for good (the deal is final for the career). */
  walkAwayFromDeal: () => void;
  skipTutorial: () => void;
  /** Escape key: closes the top-most layer (founder, map, modal, stand, books). */
  handleEscape: () => void;

  // scene events
  customerWalkout: () => void;
  taxiHit: () => void;
  /** E / click on something in the world. `plotId` names the plot for stand and lease targets. */
  interact: (target: NearbyTarget, plotId?: PlotId | null) => void;

  // movement
  /** Step behind the counter of a built stand (the active plot, or `plotId`). */
  enterStand: (plotId?: PlotId) => void;
  exitStand: () => void;
  selectNeighborhood: (id: NeighborhoodId) => void;

  // shopping & staff
  buyLemons: () => void;
  buyStallKit: () => void;
  buyPitcher: () => void;
  sellUsedPitcher: () => void;
  divestCurrentStand: () => void;
  signLease: () => void;
  buildStandOnPlot: () => void;
  /** Put a worker on the active plot's stand. */
  hireWorker: () => void;
  /** Let the active plot's worker go. */
  letWorkerGo: () => void;
  hireManager: () => void;
  setPrice: (price: number) => void;

  // brewing & serving
  startBrewGame: () => void;
  lockBrewGame: () => void;
  stirKey: (key: StirKey) => void;
  setSpaceHeld: (held: boolean) => void;
  startServeFrontCustomer: () => void;
  /** One beat of the hired manager (brew a batch or serve one customer). */
  managerTick: () => void;

  // day cycle
  tickClock: (realDtSeconds: number) => void;
  closeDay: () => void;
  startNextDay: () => void;
  /** Close the last day's receipt and show the final results (instead of a next day). */
  finishRun: () => void;

  // seller deal (each forwards to the deal machine, which enforces the rules)
  askSeller: (question: string) => void;
  submitBid: (bid: number) => void;
}

export interface GameState extends GameData {
  actions: GameActions;
}

// ---------------------------------------------------------------------------
// Seller deal: one machine actor and one server client per run (module-level so the
// store's actions and resetGameStore share them; tests swap the client in).
// ---------------------------------------------------------------------------

let dealActor: Actor<typeof dealMachine> | null = null;
let sellerClient: SellerClient | null = null;

function getSellerClient(): SellerClient {
  sellerClient ??= createSellerClient({ runId: getRunId() });
  return sellerClient;
}

/** Tests only: talk to a fake seller server instead of /api. */
export function setSellerClientForTests(client: SellerClient | null): void {
  sellerClient = client;
}

// ---------------------------------------------------------------------------
// Initial state and derived selectors
// ---------------------------------------------------------------------------

/** A brand-new run's data. Exported so tests (and `resetGameStore`) can rebuild it. */
export function createInitialGameData(): GameData {
  return {
    economy: createInitialState(),
    timeProgress: 0,
    clockSpeed: 1,
    eodRecord: null,
    runOver: false,
    workingAtStand: false,
    brewedCups: 0,
    brewGame: null,
    lastBrewKind: null,
    spaceHeld: false,
    stirShake: false,
    combo: 0,
    cashPulseKey: 0,
    serveProgress: null,
    introOpen: !hasSeenIntro(),
    runStarted: false,
    travel: null,
    founderModalOpen: true,
    mapOpen: false,
    booksOpen: false,
    activeModal: null,
    tutorialActive: true,
    founderSpecies: 'squirrel',
    neighborhoodId: 'central-park',
    activePlotId: null,
    awayCarry: {},
    lastBusinessNeighborhood: 'central-park',
    previousNeighborhood: null,
    muted: soundEngine.isMuted(),
    toasts: [],
    salePops: [],
    nextToastId: 1,
    nextPopId: 1,
    nextReviewId: 1,
    arrival: null,
    deal: null,
  };
}

/**
 * The plots of the district the player is in, with what the player has done with each
 * (empty / leased / built, staffed or not). The 3D scene draws these and the UI labels
 * them. A new array each call: subscribe through `selectDistrictPlotsKey` (a string
 * that only changes when something visible changed), then read this.
 */
export const selectDistrictPlots = (s: GameData): PlotView[] =>
  plotsIn(s.neighborhoodId).map((p) => ({
    ...p,
    // The seller's stand is shown at its real rent (it steps up after 4 days).
    dailyRent: getPlotRent(s.economy, p.id),
    status: s.economy.plots[p.id] ?? 'empty',
    staffed: s.economy.staffedPlots.includes(p.id),
  }));

/** Changes exactly when `selectDistrictPlots` would draw something different. */
export const selectDistrictPlotsKey = (s: GameData): string =>
  selectDistrictPlots(s)
    .map((p) => `${p.id}:${p.status}:${p.staffed ? 1 : 0}:${p.dailyRent}`)
    .join('|');

/**
 * THE LIVE PLOT: the one stand in this district where the 3D scene's customers queue
 * and the player serves in person. It is the plot the player last walked up to, if
 * built; otherwise the district's first built plot (corner, side, plaza order); null
 * when the district has no built stand.
 */
export const selectLivePlotId = (s: GameData): PlotId | null => {
  const built = plotsIn(s.neighborhoodId).filter((p) => s.economy.plots[p.id] === 'built');
  if (built.length === 0) return null;
  const active = built.find((p) => p.id === s.activePlotId);
  return (active ?? built[0]).id;
};

/** The plot the lease window and stand menus act on (null = none picked). */
export const selectActivePlot = (s: GameData): PlotView | null =>
  selectDistrictPlots(s).find((p) => p.id === s.activePlotId) ?? null;

/** The seller still runs their stand (Central Park only, until the player buys it). */
export const selectSellerPresent = (s: GameData): boolean =>
  s.neighborhoodId === 'central-park' && s.economy.plots[SELLER_PLOT_ID] !== 'built';

/**
 * The scene lets customers queue at the live plot only when it is built, stocked and
 * open, and only when someone will serve them: the player (or the manager) at the
 * counter, or no worker there. A staffed stand the player is not running sells through
 * core/awaySales instead; letting the scene's walkers queue there too would count its
 * customers twice (and they would walk out angry while the worker "served" them).
 */
export const selectStandOpen = (s: GameData): boolean => {
  const live = selectLivePlotId(s);
  if (live === null) return false;
  const staffedAndAway = s.economy.staffedPlots.includes(live) && !s.workingAtStand && s.economy.managers === 0;
  return (
    !staffedAndAway && s.economy.cupsInStock > 0 && s.economy.day <= s.economy.maxDays && s.eodRecord === null
  );
};

/**
 * Workers helping at the stand the player is running (0 or 1): a worker at THIS stand
 * widens the brew sweet spots (core/brewing.ts). Workers at other stands do not.
 */
export const selectWorkersHere = (s: GameData): number => {
  const live = selectLivePlotId(s);
  return live !== null && s.economy.staffedPlots.includes(live) ? 1 : 0;
};

/** True while the day clock must stand still (a panel is open, day 1 has no stand yet...). */
/**
 * Play has stopped on this screen: the day's receipt is up, or the run is over. The
 * music hushes so the screen feels different from the street (owner request,
 * 2026-11-24: the soundtrack kept playing over the receipt as if nothing happened).
 */
export const selectMusicHushed = (s: GameData): boolean => s.eodRecord !== null || s.runOver;

export const selectClockPaused = (s: GameData): boolean =>
  isClockPaused({
    overlayOpen:
      s.introOpen ||
      s.founderModalOpen ||
      s.travel !== null ||
      s.booksOpen ||
      s.activeModal !== null ||
      s.mapOpen ||
      s.eodRecord !== null ||
      s.runOver,
    day: s.economy.day,
    maxDays: s.economy.maxDays,
  });

/** Interval (ms) of the hired manager's auto-serve beat, or null when it must not run. */
export const selectManagerIntervalMs = (s: GameData): number | null => {
  const { managers, day, maxDays } = s.economy;
  if (managers <= 0 || selectLivePlotId(s) === null || day > maxDays || s.eodRecord !== null) {
    return null;
  }
  return Math.max(900, 1850 - (managers - 1) * 350);
};

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

const TOAST_LIFETIME_MS = 2200;
/** How long the district title stays up after the subway doors open. */
export const ARRIVAL_TITLE_MS = 2000;
const SALE_POP_LIFETIME_MS = 1200;
const STIR_SHAKE_MS = 180;
/**
 * How long the player must HOLD to fill one cup when they are ALONE at the counter.
 *
 * Balance pass (2026-11-24): raised from 700 ms to 2 s. One pair of hands is meant to be
 * the bottleneck of the first days: the line grows faster than the player can pour,
 * some customers walk off, and that (not a tutorial) is the push to hire. The slow hold
 * is not meant to last: with a worker at the stand the hold drops to
 * `pourDurationMs(1)` (0.6 s), see core/standSales.ts. The serve loop below reads
 * `pourDurationMs(selectWorkersHere(...))`; this constant is the alone case, kept
 * exported for tests and UI that need a number.
 */
export const POUR_DURATION_MS = TUNING.pourMsAlone;
/**
 * Subway ride timing: the screen closes over the old district, the district is swapped
 * while fully covered (so the player never sees the scene rebuild), then it opens on
 * the new one. TravelTransition.tsx animates to these same numbers.
 */
export const TRAVEL_COVER_MS = 650;
export const TRAVEL_REVEAL_MS = 550;

export const useGameStore = create<GameState>()(
  devtools(
    subscribeWithSelector((set, get) => {
      // `set` with a name shows up as that action in Redux DevTools. `false` = merge.
      const patch = (partial: Partial<GameData>, name: string): void => set(partial, false, name);

      // ---- feedback helpers --------------------------------------------------

      /**
       * Float a short note above a stand. `text` is a few words at most (the UI shows it
       * big, so there is no room for sentences); `chips` are the money that moved.
       */
      const pushNote = (
        text: string | null,
        tone: ToastTone,
        anchor: ToastAnchor,
        chips: MoneyChip[] = []
      ): void => {
        const id = get().nextToastId;
        patch(
          {
            nextToastId: id + 1,
            toasts: [...get().toasts.slice(-4), { id, text, tone, anchor, chips }],
          },
          'pushToast'
        );
        // Expire the toast later. Tracked so resetGameStore() can cancel it.
        scheduleTimeout(() => {
          patch({ toasts: get().toasts.filter((t) => t.id !== id) }, 'expireToast');
        }, TOAST_LIFETIME_MS);
      };
      const pushToast = (text: string, tone: ToastTone, anchor: ToastAnchor = 'own-stand'): void =>
        pushNote(text, tone, anchor);
      /** Money chips computed from the economy before and after an action (core/ledgerChips). */
      const pushLedger = (before: SliceState, anchor: ToastAnchor, text: string | null = null): void =>
        pushNote(text, 'neutral', anchor, ledgerChips(before, get().economy));

      const pushSalePop = (text: string, comboCount: number, isPerfect = false): void => {
        const id = get().nextPopId;
        patch(
          {
            nextPopId: id + 1,
            salePops: [...get().salePops.slice(-5), { id, text, combo: comboCount, isPerfect }],
          },
          'pushSalePop'
        );
        scheduleTimeout(() => {
          patch({ salePops: get().salePops.filter((p) => p.id !== id) }, 'expireSalePop');
        }, SALE_POP_LIFETIME_MS);
      };

      // ---- economy helpers ---------------------------------------------------

      /**
       * Every change to the economy goes through here so one follow-up rule always
       * holds: brewedCups can never exceed the cups actually in stock.
       * (The tutorial used to end at the first sale; it now ends when the first day
       * closes with a sale, see startNextDay, so its last goal can teach the 5% line.)
       */
      const commitEconomy = (
        next: SliceState,
        name: string,
        extra: Partial<Omit<GameData, 'economy'>> = {}
      ): void => {
        const brewed = extra.brewedCups ?? get().brewedCups;
        patch({ ...extra, economy: next, brewedCups: Math.min(brewed, next.cupsInStock) }, name);
      };

      /**
       * Staffed stands sell while the player is elsewhere (core/awaySales.ts). Called on
       * every clock tick with the share of the day that tick covered. The stand the
       * player is serving at in person is skipped: its sales come from the 3D scene.
       */
      const runAwaySales = (dayFraction: number): void => {
        const s = get();
        if (s.economy.staffedPlots.length === 0 || s.economy.day > s.economy.maxDays) return;
        const result = stepAwaySales({
          state: s.economy,
          livePlotId: s.workingAtStand ? selectLivePlotId(s) : null,
          reservedCups: s.brewedCups,
          dayFraction,
          carry: s.awayCarry,
          nextReviewId: s.nextReviewId,
        });
        if (result.sold > 0) {
          // A tick is a fraction of a second, so this is at most a cup or two at a time.
          commitEconomy(result.state, 'awaySales', { awayCarry: result.carry, nextReviewId: result.nextReviewId });
          soundEngine.playCoin(1);
        } else {
          patch({ awayCarry: result.carry }, 'awayCarry');
        }
        if (result.missed > 0) pushToast('Out of lemons', 'negative', 'own-stand');
      };

      /**
       * Tutorial spending guard (rule in core/tutorial.ts): while the tutorial runs,
       * refuse a purchase that would leave too little cash for the other starter items,
       * so a new player cannot strand themselves without a pitcher. Returns true when
       * the purchase may go ahead.
       */
      const tutorialAllows = (item: StarterItem, anchor: ToastAnchor): boolean => {
        if (!get().tutorialActive) return true;
        const short = starterShortfall(get().economy, item);
        if (!short) return true;
        soundEngine.playReject();
        const names = short.reservedFor.map((m) => STARTER_NAME[m]).join(' + ');
        pushToast(`Keep $${short.reserve} for ${names}`, 'negative', anchor);
        return false;
      };

      /**
       * Decide AND apply a purchase in one uninterrupted step on the current state.
       * (The old App decided on one copy of the state and applied on another.)
       */
      const runPurchase = (
        rule: (s: SliceState) => Purchases.PurchaseResult,
        name: string
      ): Purchases.PurchaseResult => {
        const result = rule(get().economy);
        if (result.ok) commitEconomy(result.state, name);
        return result;
      };

      // ---- loop helpers ------------------------------------------------------

      /** Stop the brew loop and clear the running game (only if a loop was running). */
      const stopBrewIfRunning = (): void => {
        if (cancelBrewLoop()) patch({ brewGame: null }, 'stopBrew');
      };
      const stopServeIfRunning = (): void => {
        if (cancelServeLoop()) patch({ serveProgress: null }, 'stopServe');
      };

      /** Shared by exit-stand, divest and the closing bell: stop timers, leave the counter. */
      const leaveStandAndStopLoops = (): void => {
        stopBrewIfRunning();
        stopServeIfRunning();
      };

      const finishBrewOutcome = (tier: BrewTier): void => {
        cancelBrewLoop();
        const latest = get();
        // Toasts show the cups actually added. (They used to fall back to the full
        // batch size when the pitcher was already full, which overstated the brew.)
        const { brewedCups, added } = applyBrewOutcome(tier, latest.brewedCups, latest.economy.cupsInStock);
        patch({ spaceHeld: false, brewGame: null, brewedCups }, 'finishBrew');
        if (tier === 'perfect') {
          soundEngine.playPerfect();
          // One celebration only: the pop at the stand (it used to fire a toast too).
          pushSalePop(`Perfect +${added}`, Math.max(3, get().combo), true);
        } else if (tier === 'good') {
          soundEngine.playBrew();
          pushToast(`Good +${added}`, 'positive', 'own-stand');
        } else {
          soundEngine.playReject();
          pushToast(`Sour +${added}`, 'negative', 'own-stand');
        }
      };

      /**
       * Sounds for the lemonade brew's events. The rules report them as `cues` on the
       * frame they happen (core/minigames/types.ts), so the store never has to diff the
       * old and new state to notice "seeds just started falling".
       */
      const playBrewCues = (cues: readonly BrewCue[] | undefined): void => {
        if (!cues) return;
        for (const cue of cues) {
          if (cue === 'seeds' || cue === 'overshoot' || cue === 'slop') soundEngine.playReject();
          else if (cue === 'lemon-done' || cue === 'step-done' || cue === 'fix' || cue === 'stir') soundEngine.playClick();
          // 'brew-done' is voiced by finishBrewOutcome with the tier's own sound.
        }
      };

      const pressStir = (pressedKey: StirKey): void => {
        const game = get().brewGame;
        if (!game || (game.kind !== 'rapid-stir' && game.kind !== 'lemonade-brew')) return;
        const result = pressStirKey(game, pressedKey);
        patch({ brewGame: result.state }, 'stirKey');
        if (game.kind === 'lemonade-brew') {
          // A spoon quarter turn: the rule decides clean / splash; the cue carries it.
          playBrewCues(result.cues);
          if (result.outcome) finishBrewOutcome(result.outcome);
          return;
        }
        if (result.shake) {
          soundEngine.playReject();
          patch({ stirShake: true }, 'stirShakeOn');
          scheduleTimeout(() => patch({ stirShake: false }, 'stirShakeOff'), STIR_SHAKE_MS);
          return;
        }
        soundEngine.playClick();
        if (result.outcome) finishBrewOutcome(result.outcome);
      };

      /**
       * Book one served customer: review, combo, cash, sparkles, pop-up.
       * Shared by the player's manual serve and the hired manager's auto-serve.
       * Returns the combo count after this sale.
       */
      const completeSale = (patienceRatio: number): number => {
        const s = get();
        const reviewId = s.nextReviewId;
        const nextCombo = s.combo + 1;
        const wasBelowLine = projectDay(s.economy).valueCreated < 0;
        patch({ nextReviewId: reviewId + 1, combo: nextCombo, cashPulseKey: s.cashPulseKey + 1 }, 'saleCounters');
        commitEconomy(applySale(s.economy, patienceRatio, reviewId), 'applySale', {
          brewedCups: Math.max(0, s.brewedCups - 1),
        });
        getScene()?.burstSaleSparkles(nextCombo);
        pushSalePop(salePopLabel(s.economy.pricePerCup, nextCombo), nextCombo);

        // THE MOMENT OF THE DAY: this sale pushed today's earnings past the line (rent +
        // wages + the 5% charge). It gets its own sound and note instead of the usual
        // coin, so beating the line feels like the goal it is. If a later purchase
        // raises the line again, the next crossing celebrates again.
        if (wasBelowLine && projectDay(get().economy).valueCreated >= 0) {
          soundEngine.playLineCrossed();
          pushToast('Beat the line!', 'positive', 'own-stand');
        } else {
          soundEngine.playCoin(nextCombo);
        }
        return nextCombo;
      };

      // ---- seller deal -------------------------------------------------------

      /**
       * The machine's `resolveBid` step: compare the sealed bid once (core/deal.ts, the
       * only reader of the hidden minimum), apply the result to the economy, and float
       * the money that moved. Returns the verdict for the machine.
       */
      const resolveBidNow = (bid: number) => {
        const before = get().economy;
        const result = resolveSealedBid(before, CENTRAL_PARK_DEAL, bid);
        if (result.kind === 'won') {
          commitEconomy(result.state, 'sealedBidWon');
          soundEngine.playBuy();
          pushLedger(before, 'seller-stand', 'Stand bought');
        } else if (result.kind === 'rejected') {
          commitEconomy(result.state, 'sealedBidRejected');
          soundEngine.playReject();
          pushToast('No deal', 'neutral', 'seller-stand');
        } else {
          soundEngine.playReject();
        }
        return result;
      };

      /**
       * Start the deal machine the first time the seller panel opens (that is when the
       * pitch is requested). One actor per run: a deal is final for the career, so it is
       * never restarted.
       */
      const startDealIfNeeded = (): void => {
        if (dealActor) return;
        const client = getSellerClient();
        const dealId = CENTRAL_PARK_DEAL_ID;
        const machine = dealMachine.provide({
          actors: {
            fetchPitch: fromPromise(() => client.pitch(dealId)),
            askSeller: fromPromise(({ input }) => client.ask(dealId, input.question)),
            resolveBid: fromPromise(async ({ input }) => resolveBidNow(input.bid)),
          },
        });
        const actor = createActor(machine, { input: { deal: toPublicView(CENTRAL_PARK_DEAL) } });
        actor.subscribe((snapshot) => {
          patch({ deal: toDealView(snapshot) }, 'dealSnapshot');
          if (snapshot.status !== 'done') return;
          if (snapshot.output?.outcome === 'walkedAway') {
            commitEconomy({ ...get().economy, dealStatus: 'walked-away' }, 'dealWalkedAway');
          }
          // Free the server's conversation. If this call fails the server's own expiry
          // closes it within a day, so a warning (not a player-facing error) is right.
          client.close(dealId).catch((err: unknown) => console.warn('[seller] close failed', err));
        });
        dealActor = actor;
        actor.start();
      };

      // ---- the actions -------------------------------------------------------

      const actions: GameActions = {
        // ===== ui / meta =====
        toggleSound: () => {
          soundEngine.initOnGesture();
          const nextMuted = soundEngine.toggleMute();
          patch({ muted: nextMuted }, 'toggleSound');
          if (!nextMuted) {
            soundEngine.startMusic();
            soundEngine.playClick();
          }
        },

        toggleClockSpeed: () => {
          soundEngine.playClick();
          patch({ clockSpeed: get().clockSpeed === 1 ? 2 : 1 }, 'toggleClockSpeed');
        },

        pickFounder: (species) => {
          soundEngine.playClick();
          patch({ founderSpecies: species }, 'pickFounder');
        },
        openFounderModal: () => patch({ founderModalOpen: true }, 'openFounderModal'),
        closeFounderModal: () => {
          // Before the first run starts there is nothing behind the picker to return to.
          if (!get().runStarted) return;
          patch({ founderModalOpen: false }, 'closeFounderModal');
        },
        startFromFounderModal: () => {
          soundEngine.initOnGesture();
          if (!soundEngine.isMuted()) soundEngine.startMusic();
          soundEngine.playClick();
          patch({ founderModalOpen: false, runStarted: true }, 'startFromFounderModal');
        },

        finishIntro: () => {
          soundEngine.playClick();
          markIntroSeen();
          patch({ introOpen: false }, 'finishIntro');
        },

        replayIntro: () => {
          soundEngine.playClick();
          patch({ introOpen: true }, 'replayIntro');
        },

        resetDealForDev: () => {
          dealActor?.stop();
          dealActor = null;
          patch({ deal: null }, 'resetDealForDev');
        },

        toggleMap: (opts) => {
          if (opts?.click) soundEngine.playClick();
          patch({ mapOpen: !get().mapOpen }, 'toggleMap');
        },
        closeMap: () => patch({ mapOpen: false }, 'closeMap'),
        toggleBooks: (opts) => {
          if (opts?.click) soundEngine.playClick();
          patch({ booksOpen: !get().booksOpen }, 'toggleBooks');
        },
        closeBooks: () => patch({ booksOpen: false }, 'closeBooks'),

        openModal: (modal, opts) => {
          if (opts?.click) soundEngine.playClick();
          patch({ activeModal: modal }, 'openModal');
          if (modal === 'seller-stand') startDealIfNeeded();
        },
        // Closing the panel is UI only: the deal (and its conversation) stays as it was.
        closeModal: () => patch({ activeModal: null }, 'closeModal'),
        walkAwayFromDeal: () => {
          soundEngine.playClick();
          dealActor?.send({ type: 'WALK_AWAY' });
          patch({ activeModal: null }, 'walkAway');
        },

        skipTutorial: () => {
          soundEngine.playClick();
          patch({ tutorialActive: false }, 'skipTutorial');
        },

        handleEscape: () => {
          const s = get();
          if (s.introOpen) actions.finishIntro(); // Esc skips the story
          else if (s.travel) return; // mid-ride: nothing to close
          else if (s.founderModalOpen) actions.closeFounderModal();
          else if (s.mapOpen) actions.closeMap();
          else if (s.activeModal) actions.closeModal();
          // Books before the stand: Books can be open over the stand, and it shows an
          // "Esc Close" key, so Escape must close the top-most thing the player sees.
          else if (s.booksOpen) actions.closeBooks();
          else if (s.workingAtStand) actions.exitStand();
        },

        // ===== scene events =====
        // Stand never auto-serves; sales happen only when the player manually serves
        // from behind the counter (so the scene's onCustomerPurchase has no action).
        customerWalkout: () => {
          soundEngine.playReject();
          const id = get().nextReviewId;
          patch({ combo: 0, nextReviewId: id + 1 }, 'walkoutCounters');
          commitEconomy(applyWalkout(get().economy, id), 'applyWalkout');
          pushToast('Walked out ★1', 'negative', 'own-stand');
        },

        taxiHit: () => {
          soundEngine.playHonkKo();
          pushToast('Honk!', 'negative', 'own-stand');
        },

        interact: (target, plotId = null) => {
          if (!target) return;
          if (plotId) patch({ activePlotId: plotId }, 'pickPlot');
          if (target === 'own-stand') actions.enterStand(plotId ?? undefined);
          else if (target === 'subway') actions.toggleMap({ click: true });
          else patch({ activeModal: target }, 'interact');
        },

        // ===== movement =====
        enterStand: (plotId) => {
          const id = plotId ?? get().activePlotId ?? selectLivePlotId(get());
          if (!id || get().economy.plots[id] !== 'built') return;
          soundEngine.playClick();
          // Running a stand in person makes it the live plot: the scene moves the queue
          // there (store subscription in connectScene.ts).
          patch({ activeModal: null, workingAtStand: true, activePlotId: id }, 'enterStand');
        },

        exitStand: () => {
          soundEngine.playClick();
          leaveStandAndStopLoops();
          patch({ workingAtStand: false }, 'exitStand');
        },

        /**
         * Ride the subway to another district. Instead of swapping the world instantly
         * (which felt like a glitch), the ride has three beats, driven by two timers:
         *   depart  -> travel.phase 'cover'  (TravelTransition closes over the screen)
         *   arrive  -> swap neighborhoodId while covered, travel.phase 'reveal'
         *   done    -> travel = null, the district name floats up
         * Timers go through scheduleTimeout so resetGameStore() can cancel a ride.
         */
        selectNeighborhood: (id) => {
          if (get().travel) return; // already riding
          leaveStandAndStopLoops();
          patch(
            { workingAtStand: false, activeModal: null, mapOpen: false, travel: { to: id, phase: 'cover' } },
            'travelDepart'
          );
          soundEngine.playSubwayDepart(); // chime, doors, rumble; music dips for the ride
          scheduleTimeout(() => {
            patch(
              {
                lastBusinessNeighborhood: id !== 'market' ? id : get().lastBusinessNeighborhood,
                previousNeighborhood: get().neighborhoodId,
                neighborhoodId: id,
                activePlotId: null,
                travel: { to: id, phase: 'reveal' },
              },
              'travelArrive'
            );
            // Doors open: air hiss, and the music switches to this district's theme.
            soundEngine.playSubwayArrive(id);
            scheduleTimeout(() => {
              // The district name gets its own screen title (it used to be a note on the
              // stand, where it sat on the stand's own sign and could not be read).
              const arrivalId = (get().arrival?.id ?? 0) + 1;
              patch({ travel: null, arrival: { id: arrivalId, district: id } }, 'travelDone');
              scheduleTimeout(() => {
                if (get().arrival?.id === arrivalId) patch({ arrival: null }, 'arrivalDone');
              }, ARRIVAL_TITLE_MS);
            }, TRAVEL_REVEAL_MS);
          }, TRAVEL_COVER_MS);
        },

        // ===== shopping & staff =====
        buyLemons: () => {
          if (!tutorialAllows('lemons', 'own-stand')) return;
          const before = get().economy;
          if (!runPurchase(Purchases.buyLemons, 'buyLemons').ok) {
            soundEngine.playReject();
            pushToast(`Need $${Purchases.LEMON_CRATE_COST}`, 'negative', 'own-stand');
            return;
          }
          soundEngine.playBuy();
          pushLedger(before, 'own-stand', `+${Purchases.LEMON_CRATE_CUPS} cups`);
        },

        buyStallKit: () => {
          const before = get().economy;
          if (!tutorialAllows('stall-kit', 'seller-stand')) return;
          if (!runPurchase(Purchases.buyStallKit, 'buyStallKit').ok) {
            soundEngine.playReject();
            pushToast(`Need $${STALL_KIT_COST}`, 'negative', 'seller-stand');
            return;
          }
          soundEngine.playBuy();
          pushLedger(before, 'seller-stand', '+1 stall kit');
        },

        buyPitcher: () => {
          const before = get().economy;
          if (!tutorialAllows('pitcher', 'seller-stand')) return;
          if (!runPurchase(Purchases.buyPitcher, 'buyPitcher').ok) {
            soundEngine.playReject();
            pushToast(`Need $${Purchases.PITCHER_COST}`, 'negative', 'seller-stand');
            return;
          }
          soundEngine.playBuy();
          pushLedger(before, 'seller-stand', '+1 pitcher');
        },

        sellUsedPitcher: () => {
          const before = get().economy;
          if (!runPurchase(Purchases.sellUsedPitcher, 'sellUsedPitcher').ok) {
            soundEngine.playReject();
            pushToast('No pitcher', 'negative', 'own-stand');
            return;
          }
          soundEngine.playCoin(1);
          pushLedger(before, 'own-stand', '−1 pitcher');
        },

        divestCurrentStand: () => {
          const plotId = get().activePlotId ?? selectLivePlotId(get());
          const before = get().economy;
          if (!plotId || !runPurchase((s) => Purchases.divestStand(s, plotId), 'divestStand').ok) {
            soundEngine.playReject();
            pushToast('No stand here', 'negative', 'own-stand');
            return;
          }
          leaveStandAndStopLoops();
          // The scene's plot visuals follow the economy through the store subscription.
          patch({ spaceHeld: false, workingAtStand: false, brewedCups: 0 }, 'divestStandCleanup');
          soundEngine.playCoin(1);
          pushLedger(before, 'own-stand', 'Stand sold');
        },

        signLease: () => {
          const plotId = get().activePlotId;
          if (!plotId) return;
          const before = get().economy;
          const result = runPurchase((s) => Purchases.signLease(s, plotId), 'signLease');
          if (!result.ok) {
            // The only refusal a player can run into here: the district's permit costs
            // more cash than they have (core/purchases.ts leaseFee).
            if (result.reason === 'insufficient-cash') {
              soundEngine.playReject();
              pushToast(`Permit $${Purchases.leaseFee(plotId)}`, 'negative', 'own-stand');
            }
            return;
          }
          soundEngine.playBuy();
          // The permit (if this district has one) shows as money chips: cash down, and the
          // receipt makes the cost visible at the moment it is paid.
          pushLedger(before, 'own-stand', `Leased · rent $${getPlot(plotId).dailyRent}/day`);
        },

        buildStandOnPlot: () => {
          const plotId = get().activePlotId;
          if (!plotId) return;
          const result = runPurchase((s) => Purchases.buildStand(s, plotId), 'buildStand');
          if (!result.ok) {
            if (result.reason === 'no-stall-kit') {
              soundEngine.playReject();
              pushToast('Need a stall kit', 'negative', 'own-stand');
            }
            return;
          }
          patch({ activeModal: null }, 'closeModalAfterBuild');
          soundEngine.playBuy();
          pushToast('Stand built', 'positive', 'own-stand');
        },

        hireWorker: () => {
          const plotId = get().activePlotId ?? selectLivePlotId(get());
          if (!plotId || !runPurchase((s) => Purchases.hireWorker(s, plotId), 'hireWorker').ok) {
            soundEngine.playReject();
            return;
          }
          soundEngine.playBuy();
          pushToast(`Worker · $${WORKER_DAILY_WAGE}/day`, 'positive', 'own-stand');
        },

        letWorkerGo: () => {
          const plotId = get().activePlotId ?? selectLivePlotId(get());
          if (!plotId || !runPurchase((s) => Purchases.letWorkerGo(s, plotId), 'letWorkerGo').ok) return;
          soundEngine.playClick();
          pushToast('Worker gone', 'neutral', 'own-stand');
        },

        hireManager: () => {
          commitEconomy(Purchases.hireManager(get().economy), 'hireManager');
          soundEngine.playBuy();
          pushToast(`Manager · $${MANAGER_DAILY_WAGE}/day`, 'positive', 'own-stand');
        },

        setPrice: (price) => {
          soundEngine.playClick();
          commitEconomy({ ...get().economy, pricePerCup: price }, 'setPrice');
        },

        // ===== brewing & serving =====
        startBrewGame: () => {
          if (get().brewGame) return;
          const { economy: cur, brewedCups } = get();
          if (cur.pitchers < 1) {
            soundEngine.playReject();
            pushToast('Need a pitcher', 'negative', 'own-stand');
            return;
          }
          if (cur.cupsInStock <= 0) {
            soundEngine.playReject();
            pushToast('No lemons', 'negative', 'own-stand');
            return;
          }
          if (brewedCups >= cur.cupsInStock) {
            soundEngine.playClick();
            pushToast('All brewed', 'neutral', 'own-stand');
            return;
          }

          // The lemonade brew: squeeze -> sweeten -> stir (core/minigames/lemonadeBrew.ts).
          // Its settings come from where and when the player is brewing:
          //   difficulty       later in the summer = tougher lemons, pickier taste
          //   targetSweetness  this district's taste (core/neighborhoods.ts sweetTooth)
          //   workerSqueezes   a hired helper at this stand does the squeezing for you
          const brew = lemonadeBrew.init(gameplayRandom, {
            difficulty: brewDifficulty(cur.day, cur.maxDays),
            targetSweetness: getNeighborhood(get().neighborhoodId).sweetTooth,
            workerSqueezes: selectWorkersHere(get()) > 0,
          });
          patch({ brewGame: brew, spaceHeld: false }, 'startBrew');
          soundEngine.playClick();

          // Advance the pure game state by the real frame time, publish it, and stop
          // when the rules report an outcome.
          let lastNow = performance.now();
          const tick = (now: number): void => {
            const game = get().brewGame;
            if (!game) return;
            const dt = Math.max(0, (now - lastNow) / 1000);
            lastNow = now;
            const { economy: latest, spaceHeld } = get();
            const result = stepGame(game, dt, {
              pitchers: latest.pitchers,
              workers: selectWorkersHere(get()),
              spaceHeld,
            });
            patch({ brewGame: result.state }, 'brewFrame');
            playBrewCues(result.cues);
            if (result.outcome) {
              finishBrewOutcome(result.outcome);
              return;
            }
            setBrewFrame(requestAnimationFrame(tick));
          };
          setBrewFrame(requestAnimationFrame(tick));
        },

        stirKey: (key) => pressStir(key),

        lockBrewGame: () => {
          const game = get().brewGame;
          if (!game) return;
          // The lemonade brew has no "lock": holding Space (setSpaceHeld) IS its input,
          // and the frame loop turns the hold's edges into press / release.
          if (game.kind === 'lemonade-brew') return;

          if (game.kind === 'rapid-stir') {
            pressStir(game.seq[game.index] ?? 'SPACE');
            return;
          }

          const result = pressGame(game, { pitchers: get().economy.pitchers, workers: selectWorkersHere(get()) });

          if (game.kind === 'keep-in-tube') {
            // Tapping or clicking boosts the lemon drop rightward inside the tube
            patch({ brewGame: result.state }, 'lockBrew');
            soundEngine.playClick();
            return;
          }

          if (game.kind === 'triple-squeeze' && result.state.kind === 'triple-squeeze') {
            const hit = result.state.hits > game.hits;
            if (hit) soundEngine.playClick();
            else soundEngine.playReject();
            patch({ brewGame: result.state }, 'lockBrew');
          }

          if (result.outcome) finishBrewOutcome(result.outcome);
        },

        setSpaceHeld: (held) => {
          if (get().spaceHeld !== held) patch({ spaceHeld: held }, 'setSpaceHeld');
        },

        startServeFrontCustomer: () => {
          const s = get();
          if (!s.workingAtStand || s.serveProgress !== null) return;
          if (s.economy.day > s.economy.maxDays) return;
          if (s.brewedCups < 1 || s.economy.cupsInStock < 1) {
            soundEngine.playReject();
            pushToast('Brew first', 'negative', 'own-stand');
            return;
          }
          if (anchorStore.getState().queue.length === 0) {
            soundEngine.playClick();
            return;
          }

          // PRESS AND HOLD TO SERVE ONE CUSTOMER: the cup fills only while Space (or the
          // mouse on Serve, or E on the Serve row) is held. Let go before it is full and the
          // pour is spilled: no sale, the customer keeps waiting. A full cup serves exactly
          // ONE customer; the next one needs a fresh press (held-key repeats are ignored in
          // loops.ts), so every cup is its own little act.
          const startTime = performance.now();
          // Fixed when the pour starts: alone it is a long hold, with a worker at this
          // stand a short one (the worker has the cup ready).
          const pourMs = pourDurationMs(selectWorkersHere(s));
          patch({ serveProgress: 0.01 }, 'serveStart');

          const tick = (now: number): void => {
            if (!get().spaceHeld) {
              setServeFrame(null);
              patch({ serveProgress: null }, 'serveSpilled');
              soundEngine.playReject();
              return;
            }
            const pct = Math.min(1, (now - startTime) / pourMs);
            patch({ serveProgress: pct }, 'serveFrame');
            if (pct < 1) {
              setServeFrame(requestAnimationFrame(tick));
              return;
            }
            setServeFrame(null);
            patch({ serveProgress: null }, 'serveDone');

            const served = getScene()?.serveFrontCustomer();
            if (!served) return;

            const latest = get().economy;
            if (latest.cupsInStock <= 0) return;

            // The sale pop ("+$2", combo) is the whole celebration; a second toast
            // repeating the cash in a sentence was noise.
            completeSale(served.patienceRatio);
          };
          setServeFrame(requestAnimationFrame(tick));
        },

        managerTick: () => {
          const { economy: latest, brewedCups } = get();
          if (latest.day > latest.maxDays || latest.cupsInStock <= 0) return;
          if (brewedCups < 1) {
            if (latest.pitchers < 1) return;
            patch({ brewedCups: Math.min(latest.cupsInStock, brewedCups + 4) }, 'managerBrew');
            soundEngine.playBrew();
            return;
          }
          if (anchorStore.getState().queue.length === 0) return;
          const served = getScene()?.serveFrontCustomer();
          if (!served) return;
          completeSale(served.patienceRatio);
        },

        // ===== day cycle =====
        tickClock: (realDtSeconds) => {
          const { timeProgress, clockSpeed } = get();
          const next = advanceClock(timeProgress, realDtSeconds, clockSpeed);
          patch({ timeProgress: next }, 'tickClock');
          runAwaySales(Math.min(1, next) - timeProgress);
          if (next >= 1) actions.closeDay();
        },

        closeDay: () => {
          const cur = get().economy;
          if (cur.day > cur.maxDays) return;

          // The books are closed by the pure rule in core/dayEnd.ts.
          const closed = closeBooks(cur);
          if (!closed) return;

          // Step out of stand and cancel any active brew/pour timers at the 8:00 PM bell.
          leaveStandAndStopLoops();
          // The pitcher is emptied at closing. Those cups' worth were never taken out of
          // cupsInStock, so they simply count as lemons again tomorrow: nothing is lost
          // (there is no spoilage rule yet).
          commitEconomy(closed.state, 'closeDay', {
            spaceHeld: false,
            workingAtStand: false,
            brewedCups: 0,
            awayCarry: {},
            eodRecord: closed.record,
          });
          // A won day and a lost day must not sound the same.
          if (beatTheLine(closed.record)) soundEngine.playDayEnd();
          else soundEngine.playDayLost();
        },

        finishRun: () => {
          soundEngine.playClick();
          patch({ eodRecord: null, runOver: true }, 'finishRun');
        },

        startNextDay: () => {
          soundEngine.playClick();
          // The scene's sky follows timeProgress through the store subscription.
          commitEconomy(advanceToNextDay(get().economy), 'startNextDay', { eodRecord: null, timeProgress: 0 });
          // The tutorial ends after its last goal ("beat the line"): the first day that
          // closed with at least one sale. A day 1 with no sales keeps the tutorial on.
          if (get().tutorialActive && get().economy.totalRevenue > 0) {
            patch({ tutorialActive: false }, 'completeTutorial');
            soundEngine.playPerfect();
            pushToast('Tutorial done', 'positive', 'own-stand');
          }
        },

        // ===== seller deal =====
        askSeller: (question) => {
          if (!get().deal?.canAsk) return;
          soundEngine.playClick();
          dealActor?.send({ type: 'ASK', question });
        },

        submitBid: (bid) => {
          dealActor?.send({ type: 'SUBMIT_BID', bid });
        },
      };

      return { ...createInitialGameData(), actions };
    }),
    // Only wire up the Redux DevTools in development builds that run in a browser.
    { name: 'the-next-dollar', enabled: import.meta.env.DEV && typeof window !== 'undefined' }
  )
);

/**
 * Put the store back to a brand-new run and cancel every pending timer.
 * Used by tests (one fresh store per test) and by any future "New Game" button.
 */
export function resetGameStore(): void {
  cancelAllTimers();
  dealActor?.stop();
  dealActor = null;
  useGameStore.setState(createInitialGameData(), false, 'resetGameStore');
}

