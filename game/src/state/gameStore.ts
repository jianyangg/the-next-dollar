import { type Actor, createActor, fromPromise } from 'xstate';
import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import { applyBrewOutcome, type BrewKind, type BrewTier, pickChallenge, type StirKey } from '../core/brewing';
import { advanceClock, type ClockSpeed, isClockPaused } from '../core/clock';
import { closeDay as closeBooks, startNextDay as advanceToNextDay } from '../core/dayEnd';
import { CENTRAL_PARK_DEAL, CENTRAL_PARK_DEAL_ID, resolveSealedBid, toPublicView } from '../core/deal';
import { type BrewGameState, initGame, pressGame, pressStirKey, stepGame } from '../core/minigames';
import { getNeighborhood, type NeighborhoodId } from '../core/neighborhoods';
import * as Purchases from '../core/purchases';
import { ledgerChips, type MoneyChip } from '../core/ledgerChips';
import { gameplayRandom } from '../core/runRandom';
import { applySale, applyWalkout, salePopLabel } from '../core/sales';
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
  /** 0..1 progress of the 450 ms pour animation, or null when not pouring. */
  serveProgress: number | null;

  // --- ui ---
  founderModalOpen: boolean;
  mapOpen: boolean;
  booksOpen: boolean;
  activeModal: ActiveModal;
  tutorialActive: boolean;

  // --- meta ---
  founderSpecies: FounderSpecies;
  neighborhoodId: NeighborhoodId;
  /** Last non-market district, so "Back to <district>" knows where to return. */
  lastBusinessNeighborhood: NeighborhoodId;
  muted: boolean;

  // --- feedback (floating text) and the id counters that name each item ---
  toasts: WorldNote[];
  salePops: SalePop[];
  nextToastId: number;
  nextPopId: number;
  nextReviewId: number;

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
  interact: (target: NearbyTarget) => void;

  // movement
  enterStand: () => void;
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
  hireWorker: () => void;
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
    workingAtStand: false,
    brewedCups: 0,
    brewGame: null,
    lastBrewKind: null,
    spaceHeld: false,
    stirShake: false,
    combo: 0,
    cashPulseKey: 0,
    serveProgress: null,
    founderModalOpen: true,
    mapOpen: false,
    booksOpen: false,
    activeModal: null,
    tutorialActive: true,
    founderSpecies: 'squirrel',
    neighborhoodId: 'central-park',
    lastBusinessNeighborhood: 'central-park',
    muted: soundEngine.isMuted(),
    toasts: [],
    salePops: [],
    nextToastId: 1,
    nextPopId: 1,
    nextReviewId: 1,
    deal: null,
  };
}

/** The plot status of the district the player is standing in. */
export const selectCurrentPlotStatus = (s: GameData) => s.economy.plots[s.neighborhoodId] ?? 'empty';

/** The scene should let customers queue only for a built, stocked, open stand. */
export const selectStandOpen = (s: GameData): boolean =>
  selectCurrentPlotStatus(s) === 'built' &&
  s.economy.cupsInStock > 0 &&
  s.economy.day <= s.economy.maxDays &&
  s.eodRecord === null;

/** True while the day clock must stand still (a panel is open, day 1 has no stand yet...). */
export const selectClockPaused = (s: GameData): boolean =>
  isClockPaused({
    overlayOpen: s.founderModalOpen || s.booksOpen || s.activeModal !== null || s.mapOpen || s.eodRecord !== null,
    day: s.economy.day,
    maxDays: s.economy.maxDays,
    ownedStands: s.economy.ownedStands,
  });

/** Interval (ms) of the hired manager's auto-serve beat, or null when it must not run. */
export const selectManagerIntervalMs = (s: GameData): number | null => {
  const { managers, day, maxDays } = s.economy;
  if (managers <= 0 || selectCurrentPlotStatus(s) !== 'built' || day > maxDays || s.eodRecord !== null) {
    return null;
  }
  return Math.max(900, 1850 - (managers - 1) * 350);
};

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

const TOAST_LIFETIME_MS = 2200;
const SALE_POP_LIFETIME_MS = 1200;
const STIR_SHAKE_MS = 180;
const POUR_DURATION_MS = 450;

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
       * Every change to the economy goes through here so two follow-up rules always
       * hold (they used to be separate React effects that ran a render later):
       *   1. brewedCups can never exceed the cups actually in stock.
       *   2. The first-ever sale completes the tutorial.
       */
      const commitEconomy = (
        next: SliceState,
        name: string,
        extra: Partial<Omit<GameData, 'economy'>> = {}
      ): void => {
        const brewed = extra.brewedCups ?? get().brewedCups;
        patch({ ...extra, economy: next, brewedCups: Math.min(brewed, next.cupsInStock) }, name);
        if (get().tutorialActive && next.totalRevenue > 0) {
          patch({ tutorialActive: false }, 'completeTutorial');
          soundEngine.playPerfect();
          pushToast('Tutorial done', 'positive', 'own-stand');
        }
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

      const pressStir = (pressedKey: StirKey): void => {
        const game = get().brewGame;
        if (!game || game.kind !== 'rapid-stir') return;
        const result = pressStirKey(game, pressedKey);
        patch({ brewGame: result.state }, 'stirKey');
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
        patch({ nextReviewId: reviewId + 1, combo: nextCombo, cashPulseKey: s.cashPulseKey + 1 }, 'saleCounters');
        commitEconomy(applySale(s.economy, patienceRatio, reviewId), 'applySale', {
          brewedCups: Math.max(0, s.brewedCups - 1),
        });
        soundEngine.playCoin(nextCombo);
        getScene()?.burstSaleSparkles(nextCombo);
        pushSalePop(salePopLabel(s.economy.pricePerCup, nextCombo), nextCombo);
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
        closeFounderModal: () => patch({ founderModalOpen: false }, 'closeFounderModal'),
        startFromFounderModal: () => {
          soundEngine.initOnGesture();
          if (!soundEngine.isMuted()) soundEngine.startMusic();
          soundEngine.playClick();
          patch({ founderModalOpen: false }, 'startFromFounderModal');
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
          if (s.founderModalOpen) actions.closeFounderModal();
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

        interact: (target) => {
          if (!target) return;
          if (target === 'own-stand') actions.enterStand();
          else patch({ activeModal: target }, 'interact');
        },

        // ===== movement =====
        enterStand: () => {
          soundEngine.playClick();
          // The scene is told through the store subscription in connectScene.ts.
          patch({ activeModal: null, workingAtStand: true }, 'enterStand');
        },

        exitStand: () => {
          soundEngine.playClick();
          leaveStandAndStopLoops();
          patch({ workingAtStand: false }, 'exitStand');
        },

        selectNeighborhood: (id) => {
          leaveStandAndStopLoops();
          patch(
            {
              workingAtStand: false,
              activeModal: null,
              mapOpen: false,
              lastBusinessNeighborhood: id !== 'market' ? id : get().lastBusinessNeighborhood,
              neighborhoodId: id,
            },
            'selectNeighborhood'
          );
          soundEngine.playTravel();
          const next = getNeighborhood(id);
          pushToast(next.shortName, 'neutral', 'own-stand');
        },

        // ===== shopping & staff =====
        buyLemons: () => {
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
          const district = get().neighborhoodId;
          const before = get().economy;
          if (!runPurchase((s) => Purchases.divestStand(s, district), 'divestStand').ok) {
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
          const district = get().neighborhoodId;
          if (!runPurchase((s) => Purchases.signLease(s, district), 'signLease').ok) return;
          const hood = getNeighborhood(district);
          soundEngine.playBuy();
          pushToast(`Leased · rent $${hood.dailyRent}/day`, 'positive', 'own-stand');
        },

        buildStandOnPlot: () => {
          const district = get().neighborhoodId;
          const result = runPurchase((s) => Purchases.buildStand(s, district), 'buildStand');
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
          commitEconomy(Purchases.hireWorker(get().economy), 'hireWorker');
          soundEngine.playBuy();
          pushToast(`Worker · $${WORKER_DAILY_WAGE}/day`, 'positive', 'own-stand');
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

          // One of the 4 arcade challenges, never the same one twice in a row.
          const chosen = pickChallenge(get().lastBrewKind, gameplayRandom);
          patch({ lastBrewKind: chosen, brewGame: initGame(chosen, gameplayRandom), spaceHeld: false }, 'startBrew');
          soundEngine.playClick();

          // One loop for every challenge: advance the pure game state by the real
          // frame time, publish it, and stop when the rules report an outcome.
          let lastNow = performance.now();
          const tick = (now: number): void => {
            const game = get().brewGame;
            if (!game) return;
            const dt = Math.max(0, (now - lastNow) / 1000);
            lastNow = now;
            const { economy: latest, spaceHeld } = get();
            const result = stepGame(game, dt, {
              pitchers: latest.pitchers,
              workers: latest.workers,
              spaceHeld,
            });
            patch({ brewGame: result.state }, 'brewFrame');
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

          if (game.kind === 'rapid-stir') {
            pressStir(game.seq[game.index] ?? 'SPACE');
            return;
          }

          const { pitchers, workers } = get().economy;
          const result = pressGame(game, { pitchers, workers });

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

          const startTime = performance.now();
          patch({ serveProgress: 0.01 }, 'serveStart');

          const tick = (now: number): void => {
            const pct = Math.min(1, (now - startTime) / POUR_DURATION_MS);
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
            eodRecord: closed.record,
          });
          soundEngine.playDayEnd();
        },

        startNextDay: () => {
          soundEngine.playClick();
          // The scene's sky follows timeProgress through the store subscription.
          commitEconomy(advanceToNextDay(get().economy), 'startNextDay', { eodRecord: null, timeProgress: 0 });
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

