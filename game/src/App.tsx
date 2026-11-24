import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createInitialState,
  createReviewFromPatience,
  DayRecord,
  getDailyHurdleCharge,
  getDailyWages,
  getDayNopat,
  getInvestedCapital,
  getTotalEquity,
  HURDLE_RATE,
  LedgerToast,
  MANAGER_DAILY_WAGE,
  SliceState,
  STALL_KIT_COST,
  WORKER_DAILY_WAGE,
} from './core/sliceModel';
import { getNeighborhood, NeighborhoodId } from './core/neighborhoods';
import { advanceClock, formatClockTime, isClockPaused } from './core/clock';
import { closeDay, startNextDay as advanceToNextDay } from './core/dayEnd';
import { CENTRAL_PARK_DEAL, resolveSealedBid } from './core/deal';
import * as Purchases from './core/purchases';
import { getDailyPlotRent } from './core/rent';
import { applySale, applyWalkout, salePopLabel } from './core/sales';
import { applyBrewOutcome, BrewTier, pickChallenge, StirKey, sweetSpots } from './core/brewing';
import { BrewGameState, initGame, pressGame, pressStirKey, stepGame } from './core/minigames';
import { soundEngine } from './audio/soundEngine';
import { cosmeticRandom, gameplayRandom, getRunSeed } from './core/runRandom';
import { ManhattanMapModal } from './ui/ManhattanMapModal';
import { CentralParkScene, NearbyTarget, ProjectedAnchors } from './world/CentralParkScene';
import {
  createMascotPortraitDataUrl,
  createMascotSpriteTexture,
  createUiIconDataUrl,
  FOUNDER_CATALOG,
  FounderSpecies,
  UiIconKind,
} from './world/pixelArt';

interface QaEntry {
  q: string;
  a: string;
}

interface SalePop {
  id: number;
  text: string;
  combo: number;
  isPerfect?: boolean;
}

type ActiveModal =
  | 'seller-stand'
  | 'market-stalls'
  | 'market-lemons'
  | 'market-pitchers'
  | 'plot-lease'
  | null;

const STARTER_QUESTIONS = [
  'Who runs the stand?',
  'When does the lease renew?',
  'Why are you selling?',
];

// The seller's published books, formatted for the deal table. The numbers live in core/deal.ts.
const SELLER_ASK = CENTRAL_PARK_DEAL.askingPrice;
const SELLER_PERIODS = CENTRAL_PARK_DEAL.books.map((b) => ({
  period: b.label,
  sales: `$${b.sales}`,
  lemons: `$${b.lemons}`,
  manager: `$${b.managerWage}`,
  rent: `$${b.rent}`,
  profit: `$${b.profit}`,
}));

const UI_ICON_KINDS: UiIconKind[] = [
  'coin',
  'lemon',
  'pitcher',
  'book',
  'map',
  'sun',
  'hurdle',
  'market',
];

function getConversionProb(price: number, priceSensitivity: number): number {
  const base = price <= 2 ? 0.95 : price === 3 ? 0.78 : price === 4 ? 0.42 : 0.18;
  const boost = Math.max(0, (1.1 - priceSensitivity) * Math.max(0, price - 2) * 0.55);
  return Math.min(0.96, Math.max(0.12, +(base + boost).toFixed(2)));
}

function answerSellerQuestion(q: string): string {
  const lower = q.toLowerCase();
  if (lower.includes('manager') || lower.includes('staff') || lower.includes('who runs') || lower.includes('wage')) {
    return "I've been hands-on since day one—nothing beats an owner's touch, so manager pay is $0 on the books. Sales still grew from $14 to $16 a day.";
  }
  if (lower.includes('lease') || lower.includes('rent') || lower.includes('renew')) {
    return 'Lease renews in 4 days—the landlord mentioned rent is stepping up from $3 to $5 a day on renewal. Still a prime brownstone corner.';
  }
  if (lower.includes('why') || lower.includes('sell') || lower.includes('leav')) {
    return "I'm moving to Brooklyn next week and don't want to commute uptown. Revenue hit $16 a day last period.";
  }
  return "Every number I have is right there on the sheet—sales went $14, $15, $16 a day. Ask me about staffing, the lease, or why I'm selling.";
}

function fmtSignedMoney(val: number): string {
  return `${val >= 0 ? '+' : '-'}$${Math.abs(val).toFixed(2)}`;
}

export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<CentralParkScene | null>(null);
  const toastIdRef = useRef(1);
  const reviewIdRef = useRef(1);
  const brewRafRef = useRef<number | null>(null);
  const serveRafRef = useRef<number | null>(null);

  const [state, setState] = useState<SliceState>(createInitialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Founder mascot, neighborhood & working-inside-stall state
  const [founderSpecies, setFounderSpecies] = useState<FounderSpecies>('squirrel');
  const [founderModalOpen, setFounderModalOpen] = useState(true);
  const [tutorialActive, setTutorialActive] = useState(true);
  const [neighborhoodId, setNeighborhoodId] = useState<NeighborhoodId>('central-park');
  const [lastBusinessNeighborhood, setLastBusinessNeighborhood] = useState<NeighborhoodId>('central-park');
  const [mapOpen, setMapOpen] = useState(false);

  const [workingAtStand, setWorkingAtStand] = useState(false);
  const [brewedCups, setBrewedCups] = useState(0);
  const brewedCupsRef = useRef(brewedCups);
  brewedCupsRef.current = brewedCups;

  // 4-Challenge Rotating Arcade Brewing State.
  // The whole running mini-game is one immutable value from core/minigames; the
  // ref mirrors it so the animation loop and key handlers read the latest frame.
  const [brewGame, setBrewGameState] = useState<BrewGameState | null>(null);
  const brewGameRef = useRef<BrewGameState | null>(null);
  const setBrewGame = useCallback((g: BrewGameState | null) => {
    brewGameRef.current = g;
    setBrewGameState(g);
  }, []);
  const lastBrewKindRef = useRef<BrewGameState['kind'] | null>(null);
  const spaceHeldRef = useRef(false);
  const [stirShake, setStirShake] = useState(false);

  // Read-only views of the running game for the JSX below.
  const brewGameActive = brewGame !== null;
  const brewKind = brewGame?.kind ?? 'triple-squeeze';
  const tripleGame = brewGame?.kind === 'triple-squeeze' ? brewGame : null;
  const tubeGame = brewGame?.kind === 'keep-in-tube' ? brewGame : null;
  const stirGame = brewGame?.kind === 'rapid-stir' ? brewGame : null;
  const bullseyeGame = brewGame?.kind === 'moving-bullseye' ? brewGame : null;
  const tripleTargets = tripleGame?.targets ?? [0.24, 0.5, 0.76];
  const tripleStep = tripleGame?.step ?? 0;
  const tripleHits = tripleGame?.hits ?? 0;
  const brewNeedlePos = tripleGame?.needle ?? bullseyeGame?.needle ?? 0;
  const bullseyePos = bullseyeGame?.bullseye ?? 0.5;
  const tubeCenter = tubeGame?.center ?? 0.5;
  const tubeDrop = tubeGame?.drop ?? 0.5;
  const tubeFill = tubeGame?.fill ?? 0.32;
  const stirSeq: StirKey[] = stirGame?.seq ?? ['A', 'W', 'D', 'S', 'SPACE'];
  const stirIndex = stirGame?.index ?? 0;
  const stirFuse = stirGame?.fuse ?? 1;

  // Real-Time Day Clock (8:00 AM -> 8:00 PM) & 8:00 PM Closing Bell Scorecard
  const [dayTimeProgress, setDayTimeProgress] = useState(0);
  const dayTimeProgressRef = useRef(0);
  const [clockSpeed, setClockSpeed] = useState<1 | 2>(1);
  const [eodRecord, setEodRecord] = useState<DayRecord | null>(null);

  const [serveProgress, setServeProgress] = useState<number | null>(null);
  const [combo, setCombo] = useState(0);
  const comboRef = useRef(0);
  const [cashPulseKey, setCashPulseKey] = useState(0);
  const [salePops, setSalePops] = useState<SalePop[]>([]);
  const popIdRef = useRef(1);
  const [muted, setMuted] = useState<boolean>(() => soundEngine.isMuted());

  const neighborhood = useMemo(() => getNeighborhood(neighborhoodId), [neighborhoodId]);
  const lastBusinessDistrict = useMemo(
    () => getNeighborhood(lastBusinessNeighborhood),
    [lastBusinessNeighborhood]
  );
  const neighborhoodRef = useRef(neighborhood);
  neighborhoodRef.current = neighborhood;

  // Pre-render crisp 32x32 pixel mascot portraits, 32x40 full standing sprites & 16x16 UI icons once
  const portraits = useMemo(() => {
    const map = {} as Record<FounderSpecies, string>;
    for (const f of FOUNDER_CATALOG) {
      map[f.id] = createMascotPortraitDataUrl(f.id);
    }
    return map;
  }, []);

  const standingSprites = useMemo(() => {
    const map = {} as Record<FounderSpecies, string>;
    for (const f of FOUNDER_CATALOG) {
      const tex = createMascotSpriteTexture(f.id, 0, 'down');
      const img = tex.image as HTMLCanvasElement | undefined;
      map[f.id] =
        img && typeof img.toDataURL === 'function'
          ? img.toDataURL()
          : createMascotPortraitDataUrl(f.id);
    }
    return map;
  }, []);

  const icons = useMemo(() => {
    const map = {} as Record<UiIconKind, string>;
    for (const k of UI_ICON_KINDS) {
      map[k] = createUiIconDataUrl(k);
    }
    return map;
  }, []);

  const selectedFounder = useMemo(
    () => FOUNDER_CATALOG.find((f) => f.id === founderSpecies) ?? FOUNDER_CATALOG[0],
    [founderSpecies]
  );

  const [anchors, setAnchors] = useState<ProjectedAnchors>({
    ownStand: { x: 640, y: 360 },
    sellerStand: { x: 320, y: 360 },
    marketAnchors: {
      stalls: { x: 360, y: 350 },
      pitchers: { x: 640, y: 350 },
      lemons: { x: 920, y: 350 },
    },
    player: { x: 500, y: 400 },
    nearby: null,
    queue: [],
  });
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;

  const [toasts, setToasts] = useState<LedgerToast[]>([]);
  const [booksOpen, setBooksOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

  // Seller Q&A + sealed bid state
  const [qaLog, setQaLog] = useState<QaEntry[]>([]);
  const [questionInput, setQuestionInput] = useState('');
  const [bidInput, setBidInput] = useState('45');
  const [bidMessage, setBidMessage] = useState<string | null>(null);

  const pushToast = useCallback(
    (text: string, tone: LedgerToast['tone'], anchor: LedgerToast['anchor'] = 'own-stand') => {
      const id = toastIdRef.current++;
      setToasts((prev) => [...prev.slice(-4), { id, text, tone, anchor }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 2200);
    },
    []
  );

  const pushSalePop = useCallback((text: string, comboCount: number, isPerfect = false) => {
    const id = popIdRef.current++;
    setSalePops((prev) => [...prev.slice(-5), { id, text, combo: comboCount, isPerfect }]);
    window.setTimeout(() => {
      setSalePops((prev) => prev.filter((p) => p.id !== id));
    }, 1200);
  }, []);

  const enterStand = useCallback(() => {
    soundEngine.playClick();
    setActiveModal(null);
    setWorkingAtStand(true);
    sceneRef.current?.setWorkingAtStand(true);
  }, []);

  const exitStand = useCallback(() => {
    soundEngine.playClick();
    if (brewRafRef.current !== null) {
      cancelAnimationFrame(brewRafRef.current);
      brewRafRef.current = null;
      setBrewGame(null);
    }
    if (serveRafRef.current !== null) {
      cancelAnimationFrame(serveRafRef.current);
      serveRafRef.current = null;
      setServeProgress(null);
    }
    setWorkingAtStand(false);
    sceneRef.current?.setWorkingAtStand(false);
  }, []);

  // Initialize Web Audio & cozy background music on first user gesture
  useEffect(() => {
    const unlockAudio = () => {
      soundEngine.initOnGesture();
      if (!soundEngine.isMuted()) {
        soundEngine.startMusic();
      }
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      soundEngine.stopMusic();
    };
  }, []);

  const handleToggleSound = () => {
    soundEngine.initOnGesture();
    const nextMuted = soundEngine.toggleMute();
    setMuted(nextMuted);
    if (!nextMuted) {
      soundEngine.startMusic();
      soundEngine.playClick();
    }
  };

  // Stand never auto-serves; sales happen only when the player manually serves from behind the counter
  const handleCustomerPurchase = useCallback(() => {}, []);

  const handleCustomerWalkout = useCallback(() => {
    soundEngine.playReject();
    comboRef.current = 0;
    setCombo(0);
    const id = reviewIdRef.current++;
    setState((prev) => applyWalkout(prev, id));
    pushToast('★ 1.0 Customer left!', 'negative', 'own-stand');
  }, [pushToast]);

  const handleTaxiHit = useCallback(() => {
    soundEngine.playHonkKo();
    pushToast('Beep! Watch the NYC cabs!', 'negative', 'own-stand');
  }, [pushToast]);

  const handleInteract = useCallback(
    (target: NearbyTarget) => {
      if (!target) return;
      if (target === 'own-stand') {
        enterStand();
      } else {
        setActiveModal(target);
      }
    },
    [enterStand]
  );

  useEffect(() => {
    if (!mountRef.current) return;
    const world = new CentralParkScene(mountRef.current, {
      onCustomerPurchase: handleCustomerPurchase,
      onCustomerWalkout: handleCustomerWalkout,
      onTaxiHit: handleTaxiHit,
      onAnchorsUpdate: setAnchors,
      onInteract: handleInteract,
    }, { gameplay: gameplayRandom, cosmetic: cosmeticRandom });
    sceneRef.current = world;
    world.setPlayerSpecies(founderSpecies);
    world.setNeighborhood(neighborhoodId);
    world.setPlotState(stateRef.current.plots[neighborhoodId] ?? 'empty');
    world.setTimeOfDay(dayTimeProgressRef.current);
    return () => {
      if (brewRafRef.current !== null) cancelAnimationFrame(brewRafRef.current);
      if (serveRafRef.current !== null) cancelAnimationFrame(serveRafRef.current);
      world.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleCustomerPurchase, handleCustomerWalkout, handleTaxiHit, handleInteract]);

  const currentPlotStatus = state.plots[neighborhoodId] ?? 'empty';

  useEffect(() => {
    sceneRef.current?.setPlotState(currentPlotStatus);
  }, [neighborhoodId, currentPlotStatus]);

  useEffect(() => {
    sceneRef.current?.setPitcherCount(state.pitchers);
    sceneRef.current?.setStandOpen(
      currentPlotStatus === 'built' &&
        state.cupsInStock > 0 &&
        state.day <= state.maxDays &&
        eodRecord === null
    );
  }, [state.pitchers, state.cupsInStock, state.day, state.maxDays, currentPlotStatus, eodRecord]);

  useEffect(() => {
    sceneRef.current?.setPlayerSpecies(founderSpecies);
  }, [founderSpecies]);

  // Keep brewedCups clamped to available cupsInStock
  useEffect(() => {
    setBrewedCups((c) => Math.min(c, state.cupsInStock));
  }, [state.cupsInStock]);

  // Auto-complete First-Stall Guided Tutorial as soon as 1 customer is served
  useEffect(() => {
    if (tutorialActive && state.totalRevenue > 0) {
      setTutorialActive(false);
      soundEngine.playPerfect();
      pushToast('Tutorial complete! Build your NYC empire before Day 30.', 'positive', 'own-stand');
    }
  }, [tutorialActive, state.totalRevenue, pushToast]);

  const handleSelectNeighborhood = useCallback(
    (id: NeighborhoodId) => {
      if (brewRafRef.current !== null) {
        cancelAnimationFrame(brewRafRef.current);
        brewRafRef.current = null;
        setBrewGame(null);
      }
      if (serveRafRef.current !== null) {
        cancelAnimationFrame(serveRafRef.current);
        serveRafRef.current = null;
        setServeProgress(null);
      }
      if (workingAtStand) {
        setWorkingAtStand(false);
        sceneRef.current?.setWorkingAtStand(false);
      }
      setActiveModal(null);
      setMapOpen(false);
      if (id !== 'market') {
        setLastBusinessNeighborhood(id);
      }
      setNeighborhoodId(id);
      sceneRef.current?.setNeighborhood(id);
      soundEngine.playTravel();
      const next = getNeighborhood(id);
      pushToast(
        id === 'market'
          ? `Arrived at ${next.name} · Wholesale Stalls Open!`
          : `Subway to ${next.name} · Rent $${next.dailyRent}/day`,
        'neutral',
        'own-stand'
      );
    },
    [pushToast, workingAtStand]
  );

  const stopInputKeyPropagation = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') {
      e.nativeEvent.stopPropagation();
    }
  };

  // Sweet-spot widths widen with pitchers and hired workers (core/brewing.ts)
  const { perfectHalf, goodHalf, tubeWidth } = sweetSpots(state);

  const finishBrewOutcome = useCallback(
    (tier: BrewTier) => {
      if (brewRafRef.current !== null) {
        cancelAnimationFrame(brewRafRef.current);
        brewRafRef.current = null;
      }
      spaceHeldRef.current = false;
      setBrewGame(null);

      const latest = stateRef.current;
      // Toasts show the cups actually added. (They used to fall back to the full
      // batch size when the pitcher was already full, which overstated the brew.)
      const { added } = applyBrewOutcome(tier, brewedCupsRef.current, latest.cupsInStock);
      setBrewedCups((prev) => applyBrewOutcome(tier, prev, latest.cupsInStock).brewedCups);
      if (tier === 'perfect') {
        soundEngine.playPerfect();
        pushSalePop(`✨ PERFECT BREW! +${added}`, Math.max(3, comboRef.current), true);
        pushToast(`✨ PERFECT BREW! +${added}`, 'positive', 'own-stand');
      } else if (tier === 'good') {
        soundEngine.playBrew();
        pushToast(`GOOD BREW! +${added}`, 'positive', 'own-stand');
      } else {
        soundEngine.playReject();
        pushToast(`Sour batch (+${added})`, 'negative', 'own-stand');
      }
    },
    [pushSalePop, pushToast, setBrewGame]
  );

  const startBrewGame = useCallback(() => {
    if (brewGameRef.current) return;
    const cur = stateRef.current;
    if (cur.pitchers < 1) {
      soundEngine.playReject();
      pushToast('Buy a Glass Pitcher ($10) at Union Sq. Market first!', 'negative', 'own-stand');
      return;
    }
    if (cur.cupsInStock <= 0) {
      soundEngine.playReject();
      pushToast('No lemons left! Visit Union Sq. Supply Market', 'negative', 'own-stand');
      return;
    }
    if (brewedCupsRef.current >= cur.cupsInStock) {
      soundEngine.playClick();
      pushToast('All lemons already brewed & ready to serve!', 'neutral', 'own-stand');
      return;
    }

    // One of the 4 arcade challenges, never the same one twice in a row.
    const chosen = pickChallenge(lastBrewKindRef.current, gameplayRandom);
    lastBrewKindRef.current = chosen;
    setBrewGame(initGame(chosen, gameplayRandom));
    soundEngine.playClick();
    spaceHeldRef.current = false;

    // One loop for every challenge: advance the pure game state by the real
    // frame time, render it, and stop when the rules report an outcome.
    let lastNow = performance.now();
    const tick = (now: number) => {
      const game = brewGameRef.current;
      if (!game) return;
      const dt = Math.max(0, (now - lastNow) / 1000);
      lastNow = now;
      const latest = stateRef.current;
      const result = stepGame(game, dt, {
        pitchers: latest.pitchers,
        workers: latest.workers,
        spaceHeld: spaceHeldRef.current,
      });
      setBrewGame(result.state);
      if (result.outcome) {
        finishBrewOutcome(result.outcome);
        return;
      }
      brewRafRef.current = requestAnimationFrame(tick);
    };
    brewRafRef.current = requestAnimationFrame(tick);
  }, [finishBrewOutcome, pushToast, setBrewGame]);

  const handleStirKeyInput = useCallback(
    (pressedKey: StirKey) => {
      const game = brewGameRef.current;
      if (!game || game.kind !== 'rapid-stir') return;
      const result = pressStirKey(game, pressedKey);
      setBrewGame(result.state);
      if (result.shake) {
        soundEngine.playReject();
        setStirShake(true);
        window.setTimeout(() => setStirShake(false), 180);
        return;
      }
      soundEngine.playClick();
      if (result.outcome) finishBrewOutcome(result.outcome);
    },
    [finishBrewOutcome, setBrewGame]
  );

  const lockBrewGame = useCallback(() => {
    const game = brewGameRef.current;
    if (!game) return;

    if (game.kind === 'rapid-stir') {
      handleStirKeyInput(game.seq[game.index] ?? 'SPACE');
      return;
    }

    const latest = stateRef.current;
    const result = pressGame(game, { pitchers: latest.pitchers, workers: latest.workers });

    if (game.kind === 'keep-in-tube') {
      // Tapping or clicking boosts the lemon drop rightward inside the tube
      setBrewGame(result.state);
      soundEngine.playClick();
      return;
    }

    if (game.kind === 'triple-squeeze' && result.state.kind === 'triple-squeeze') {
      const hit = result.state.hits > game.hits;
      if (hit) {
        soundEngine.playClick();
      } else {
        soundEngine.playReject();
      }
      setBrewGame(result.state);
    }

    if (result.outcome) finishBrewOutcome(result.outcome);
  }, [finishBrewOutcome, handleStirKeyInput, setBrewGame]);

  const startServeFrontCustomer = useCallback(() => {
    if (!workingAtStand || serveProgress !== null) return;
    const cur = stateRef.current;
    if (cur.day > cur.maxDays) return;
    if (brewedCupsRef.current < 1 || cur.cupsInStock < 1) {
      soundEngine.playReject();
      pushToast('Brew a pitcher first!', 'negative', 'own-stand');
      return;
    }
    if (anchorsRef.current.queue.length === 0) {
      soundEngine.playClick();
      return;
    }

    const durationMs = 450;
    const startTime = performance.now();
    setServeProgress(0.01);

    const tick = (now: number) => {
      const pct = Math.min(1, (now - startTime) / durationMs);
      setServeProgress(pct);
      if (pct < 1) {
        serveRafRef.current = requestAnimationFrame(tick);
      } else {
        serveRafRef.current = null;
        setServeProgress(null);

        const served = sceneRef.current?.serveFrontCustomer();
        if (!served) return;

        const latest = stateRef.current;
        if (latest.cupsInStock <= 0) return;

        const revId = reviewIdRef.current++;
        const reviewPreview = createReviewFromPatience(served.patienceRatio, revId);
        const nextCombo = comboRef.current + 1;
        comboRef.current = nextCombo;
        setCombo(nextCombo);
        setCashPulseKey((k) => k + 1);

        setState((prev) => applySale(prev, served.patienceRatio, revId));
        setBrewedCups((c) => Math.max(0, c - 1));
        soundEngine.playCoin(nextCombo);
        sceneRef.current?.burstSaleSparkles(nextCombo);
        pushSalePop(salePopLabel(latest.pricePerCup, nextCombo), nextCombo);
        pushToast(
          `+$${latest.pricePerCup} Cash · ★ ${reviewPreview.stars.toFixed(1)}`,
          reviewPreview.stars >= 4 ? 'positive' : 'neutral',
          'own-stand'
        );
      }
    };
    serveRafRef.current = requestAnimationFrame(tick);
  }, [workingAtStand, serveProgress, pushSalePop, pushToast]);

  // Global UI shortcuts: [B] Books, [M] NY Map, [F] Brew, [Space] Squeeze/Serve, [Esc] closes modals / steps out
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

      if (e.key === 'Escape') {
        if (founderModalOpen) {
          setFounderModalOpen(false);
        } else if (mapOpen) {
          setMapOpen(false);
        } else if (activeModal) {
          setActiveModal(null);
        } else if (workingAtStand) {
          exitStand();
        } else if (booksOpen) {
          setBooksOpen(false);
        }
        return;
      }

      if (isTyping || e.metaKey || e.ctrlKey || e.altKey) return;

      const k = e.key.toLowerCase();
      if (brewGameActive && brewGameRef.current?.kind === 'rapid-stir' && workingAtStand) {
        if (k === 'w' || e.key === 'ArrowUp') {
          e.preventDefault();
          handleStirKeyInput('W');
          return;
        }
        if (k === 'a' || e.key === 'ArrowLeft') {
          e.preventDefault();
          handleStirKeyInput('A');
          return;
        }
        if (k === 's' || e.key === 'ArrowDown') {
          e.preventDefault();
          handleStirKeyInput('S');
          return;
        }
        if (k === 'd' || e.key === 'ArrowRight') {
          e.preventDefault();
          handleStirKeyInput('D');
          return;
        }
        if (e.code === 'Space') {
          e.preventDefault();
          handleStirKeyInput('SPACE');
          return;
        }
      }

      if (k === 'b') {
        e.preventDefault();
        setBooksOpen((v) => !v);
      } else if (k === 'm') {
        e.preventDefault();
        setMapOpen((v) => !v);
      } else if (k === 'f' && workingAtStand && !activeModal && !mapOpen && !founderModalOpen && !eodRecord) {
        e.preventDefault();
        if (!brewGameActive) {
          startBrewGame();
        }
      } else if (
        e.code === 'Space' &&
        workingAtStand &&
        !activeModal &&
        !mapOpen &&
        !founderModalOpen &&
        !eodRecord
      ) {
        e.preventDefault();
        spaceHeldRef.current = true;
        if (brewGameActive) {
          if (brewGameRef.current?.kind !== 'keep-in-tube') {
            lockBrewGame();
          }
        } else {
          startServeFrontCustomer();
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    activeModal,
    booksOpen,
    mapOpen,
    founderModalOpen,
    eodRecord,
    workingAtStand,
    brewGameActive,
    exitStand,
    startBrewGame,
    lockBrewGame,
    handleStirKeyInput,
    startServeFrontCustomer,
  ]);

  // Autonomous Manager Loop: auto-brews & serves queued customers steadily when hired
  useEffect(() => {
    if (
      state.managers <= 0 ||
      currentPlotStatus !== 'built' ||
      state.day > state.maxDays ||
      eodRecord !== null
    ) {
      return;
    }
    const intervalMs = Math.max(900, 1850 - (state.managers - 1) * 350);
    const timer = window.setInterval(() => {
      const latest = stateRef.current;
      if (latest.day > latest.maxDays || latest.cupsInStock <= 0) return;
      if (brewedCupsRef.current < 1) {
        if (latest.pitchers < 1) return;
        setBrewedCups((prev) => Math.min(latest.cupsInStock, prev + 4));
        soundEngine.playBrew();
        return;
      }
      if (anchorsRef.current.queue.length === 0) return;
      const served = sceneRef.current?.serveFrontCustomer();
      if (!served) return;

      const revId = reviewIdRef.current++;
      const nextCombo = comboRef.current + 1;
      comboRef.current = nextCombo;
      setCombo(nextCombo);
      setCashPulseKey((k) => k + 1);

      setState((prev) => applySale(prev, served.patienceRatio, revId));
      setBrewedCups((c) => Math.max(0, c - 1));
      soundEngine.playCoin(nextCombo);
      sceneRef.current?.burstSaleSparkles(nextCombo);
      pushSalePop(salePopLabel(latest.pricePerCup, nextCombo), nextCombo);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [state.managers, state.day, state.maxDays, currentPlotStatus, eodRecord, pushSalePop]);

  /**
   * Run a pure purchase rule from core/purchases.
   * The yes/no decision uses the latest committed state (stateRef), and the update
   * re-runs the same rule on React's `prev` so concurrent updates (a sale landing in
   * the same frame) are never overwritten. Phase 3's store removes this double run.
   */
  const runPurchase = (rule: (s: SliceState) => Purchases.PurchaseResult): Purchases.PurchaseResult => {
    const decision = rule(stateRef.current);
    if (decision.ok) {
      setState((prev) => {
        const r = rule(prev);
        return r.ok ? r.state : prev;
      });
    }
    return decision;
  };

  const buyLemons = () => {
    if (!runPurchase(Purchases.buyLemons).ok) {
      soundEngine.playReject();
      pushToast(`Not enough cash ($${Purchases.LEMON_CRATE_COST} needed)`, 'negative', 'own-stand');
      return;
    }
    soundEngine.playBuy();
    pushToast('Cash -$5 · Stock +$5 (+10 cups) · Profit $0', 'neutral', 'own-stand');
  };

  const buyStallKit = () => {
    if (!runPurchase(Purchases.buyStallKit).ok) {
      soundEngine.playReject();
      pushToast(`Not enough cash ($${STALL_KIT_COST} needed)`, 'negative', 'seller-stand');
      return;
    }
    soundEngine.playBuy();
    pushToast(
      `Cash -$${STALL_KIT_COST} · Equip +$${STALL_KIT_COST} (+1 Stall Kit) · Profit $0`,
      'neutral',
      'seller-stand'
    );
  };

  const buyPitcher = () => {
    if (!runPurchase(Purchases.buyPitcher).ok) {
      soundEngine.playReject();
      pushToast(`Not enough cash ($${Purchases.PITCHER_COST} needed)`, 'negative', 'seller-stand');
      return;
    }
    soundEngine.playBuy();
    pushToast('Cash -$10 · Equip +$10 (+1 Pitcher) · Profit $0', 'neutral', 'seller-stand');
  };

  const sellUsedPitcher = () => {
    if (!runPurchase(Purchases.sellUsedPitcher).ok) {
      soundEngine.playReject();
      pushToast('No pitchers to sell!', 'negative', 'own-stand');
      return;
    }
    soundEngine.playCoin(1);
    pushToast('Sold Pitcher: Cash +$7 | Equip -$10 | Hurdle -$0.50/d', 'neutral', 'own-stand');
  };

  const divestCurrentStand = () => {
    if (!runPurchase((s) => Purchases.divestStand(s, neighborhoodId)).ok) {
      soundEngine.playReject();
      pushToast('No built stand in this district to divest!', 'negative', 'own-stand');
      return;
    }
    if (brewRafRef.current !== null) {
      cancelAnimationFrame(brewRafRef.current);
      brewRafRef.current = null;
      setBrewGame(null);
    }
    if (serveRafRef.current !== null) {
      cancelAnimationFrame(serveRafRef.current);
      serveRafRef.current = null;
      setServeProgress(null);
    }
    spaceHeldRef.current = false;
    setWorkingAtStand(false);
    sceneRef.current?.setWorkingAtStand(false);
    sceneRef.current?.setPlotState('empty');
    setBrewedCups(0);
    soundEngine.playCoin(1);
    pushToast('Divested Stand: Cash +$8.40 | Equip -$12 | Hurdle -$0.60/d', 'neutral', 'own-stand');
  };

  const signLease = () => {
    if (!runPurchase((s) => Purchases.signLease(s, neighborhoodId)).ok) return;
    soundEngine.playBuy();
    pushToast(
      `Leased ${neighborhood.shortName} Plot ($${neighborhood.dailyRent}/day) — Ready for a Stall Kit!`,
      'positive',
      'own-stand'
    );
  };

  const buildStandOnPlot = () => {
    const result = runPurchase((s) => Purchases.buildStand(s, neighborhoodId));
    if (!result.ok) {
      if (result.reason === 'no-stall-kit') {
        soundEngine.playReject();
        pushToast(`Need a Stall Kit ($${STALL_KIT_COST}) from Union Sq. Market!`, 'negative', 'own-stand');
      }
      return;
    }
    setActiveModal(null);
    soundEngine.playBuy();
    pushToast(`Stand Built in ${neighborhood.shortName}! Press [E] to step behind the counter.`, 'positive', 'own-stand');
  };

  const hireWorker = () => {
    setState(Purchases.hireWorker);
    soundEngine.playBuy();
    pushToast(`Hired Worker ($${WORKER_DAILY_WAGE}/day) · Brew sweet spot widened!`, 'positive', 'own-stand');
  };

  const hireManager = () => {
    setState(Purchases.hireManager);
    soundEngine.playBuy();
    pushToast(`Hired Manager ($${MANAGER_DAILY_WAGE}/day) · Stand auto-brews & serves!`, 'positive', 'own-stand');
  };

  // Daily rent: every leased/built district plot plus any acquired seller stand (core/rent.ts)
  const dailyPlotRent = getDailyPlotRent(state);

  const dailyWages = getDailyWages(state);

  const triggerEndOfDay = useCallback(() => {
    const cur = stateRef.current;
    if (cur.day > cur.maxDays) return;

    // Step out of stand and cancel any active brew/pour timers at 8:00 PM closing bell
    if (brewRafRef.current !== null) {
      cancelAnimationFrame(brewRafRef.current);
      brewRafRef.current = null;
      setBrewGame(null);
    }
    if (serveRafRef.current !== null) {
      cancelAnimationFrame(serveRafRef.current);
      serveRafRef.current = null;
      setServeProgress(null);
    }
    spaceHeldRef.current = false;
    setWorkingAtStand(false);
    sceneRef.current?.setWorkingAtStand(false);

    // Unserved brewed lemonade in the pitcher spoils overnight; raw lemons in crate stay
    setBrewedCups(0);

    // The books are closed by the pure rule in core/dayEnd.ts.
    const closed = closeDay(cur);
    if (!closed) return;
    const { record } = closed;
    setState((prev) => closeDay(prev)?.state ?? prev);

    setEodRecord(record);
    soundEngine.playDayEnd();
  }, []);

  const startNextDay = useCallback(() => {
    soundEngine.playClick();
    setEodRecord(null);
    dayTimeProgressRef.current = 0;
    setDayTimeProgress(0);
    sceneRef.current?.setTimeOfDay(0);
    setState(advanceToNextDay);
  }, []);

  // Smart Pause & Real-Time Day Clock (8:00 AM -> 8:00 PM over 120s at 1x, 60s at 2x)
  const clockPaused = isClockPaused({
    overlayOpen: founderModalOpen || booksOpen || activeModal !== null || mapOpen || eodRecord !== null,
    day: state.day,
    maxDays: state.maxDays,
    ownedStands: state.ownedStands,
  });

  useEffect(() => {
    if (clockPaused) return;
    let lastTime = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      const realDt = (now - lastTime) / 1000;
      lastTime = now;
      const next = advanceClock(dayTimeProgressRef.current, realDt, clockSpeed);
      dayTimeProgressRef.current = next;
      setDayTimeProgress(next);
      sceneRef.current?.setTimeOfDay(next);
      if (next >= 1) {
        window.clearInterval(interval);
        triggerEndOfDay();
      }
    }, 80);
    return () => window.clearInterval(interval);
  }, [clockPaused, clockSpeed, triggerEndOfDay]);

  const submitQuestion = (rawQuestion: string) => {
    const trimmed = rawQuestion.trim();
    if (!trimmed || qaLog.length >= 3 || state.dealStatus !== 'open') return;
    soundEngine.playClick();
    const ans = answerSellerQuestion(trimmed);
    setQaLog((prev) => [...prev, { q: trimmed, a: ans }]);
  };

  const askSeller = (e: React.FormEvent) => {
    e.preventDefault();
    submitQuestion(questionInput);
    setQuestionInput('');
  };

  const submitSealedBid = () => {
    const bid = Number(bidInput);
    // The hidden minimum is compared only inside core/deal.ts.
    const result = resolveSealedBid(stateRef.current, CENTRAL_PARK_DEAL, bid);
    if (result.kind === 'deal-closed' || result.kind === 'invalid') return;
    if (result.kind === 'insufficient-cash') {
      soundEngine.playReject();
      setBidMessage(`Insufficient cash: you have $${result.cash.toFixed(2)}.`);
      return;
    }
    // Re-resolve on React's latest state so a sale landing in the same frame is kept.
    setState((prev) => {
      const r = resolveSealedBid(prev, CENTRAL_PARK_DEAL, bid);
      return r.kind === 'won' || r.kind === 'rejected' ? r.state : prev;
    });
    if (result.kind === 'won') {
      soundEngine.playBuy();
      setBidMessage(`Accepted! Stand joined your chain at $${bid}.`);
      pushToast(`Acquired Stand · Cash -$${bid} · Equip +$${bid}`, 'positive', 'seller-stand');
    } else {
      soundEngine.playReject();
      setBidMessage(`Seller declined your $${bid} bid and walked away. Deal closed.`);
      pushToast(`Bid $${bid} Rejected — Cash Preserved`, 'neutral', 'seller-stand');
    }
  };

  // Derived financial metrics
  const investedCap = getInvestedCapital(state);
  const dailyHurdle = getDailyHurdleCharge(state);
  const liveNopat = getDayNopat(state);
  const estRent = dailyPlotRent;
  const projectedNopat = +(liveNopat - estRent - dailyWages).toFixed(2);
  const projectedEva = +(projectedNopat - dailyHurdle).toFixed(2);

  const totalAssets = +(state.cash + state.inventoryValue + state.equipmentValue).toFixed(2);
  const totalEquity = getTotalEquity(state);
  const isBalanced = Math.abs(totalAssets - totalEquity) < 0.005;

  const dayClockPct = Math.min(100, Math.max(0, Math.round(dayTimeProgress * 100)));
  const clockLabel = formatClockTime(dayTimeProgress);

  // NOPAT vs 5% Hurdle visual meter scaling
  const meterScaleMax = Math.max(dailyHurdle * 2.5, Math.max(projectedNopat, 0) * 1.15, 4);
  const hurdleMarkerPct = Math.min(92, Math.max(10, (dailyHurdle / meterScaleMax) * 100));
  const nopatFillPct = Math.min(100, Math.max(0, (Math.max(projectedNopat, 0) / meterScaleMax) * 100));
  const clearsHurdle = projectedNopat >= dailyHurdle;

  // Live sealed bid calculations
  const parsedBid = Number(bidInput);
  const validBid = Number.isFinite(parsedBid) && parsedBid > 0 ? parsedBid : 0;
  const impliedBidHurdle = +(validBid * HURDLE_RATE).toFixed(2);
  const newTotalHurdle = +(dailyHurdle + impliedBidHurdle).toFixed(2);
  const cashAfterBid = +(state.cash - validBid).toFixed(2);

  const brewPct = state.cupsInStock > 0 ? Math.min(100, Math.round((brewedCups / state.cupsInStock) * 100)) : 0;
  const noOverlayOpen = !activeModal && !founderModalOpen && !mapOpen && !workingAtStand && !eodRecord;

  const trajectoryScaleMax = useMemo(() => {
    let maxAbs = 4;
    for (const r of state.dayHistory) {
      maxAbs = Math.max(maxAbs, Math.abs(r.valueCreated));
    }
    return maxAbs;
  }, [state.dayHistory]);

  const renderValueTrajectoryStrip = () => (
    <div className="trajectory-strip" aria-label="30-Day Value Trajectory">
      <div className="trajectory-bars">
        {Array.from({ length: state.maxDays }, (_, i) => {
          const dayNum = i + 1;
          const rec = state.dayHistory.find((r) => r.day === dayNum);
          if (!rec) {
            return (
              <div
                key={dayNum}
                className={`traj-slot ${dayNum === state.day ? 'is-today' : ''}`}
                title={`Day ${dayNum}`}
              >
                <div className="traj-bar is-empty" />
              </div>
            );
          }
          const hPct = Math.max(14, Math.min(100, Math.round((Math.abs(rec.valueCreated) / trajectoryScaleMax) * 100)));
          const isPos = rec.valueCreated >= 0;
          return (
            <div
              key={dayNum}
              className="traj-slot"
              title={`Day ${dayNum}: ${fmtSignedMoney(rec.valueCreated)} EVA (Grade ${rec.grade})`}
            >
              <div
                className={`traj-bar ${isPos ? 'is-pos' : 'is-neg'}`}
                style={{ height: `${hPct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="trajectory-foot game-num">
        <span>Day 1</span>
        <span>{state.dayHistory.length} / {state.maxDays} Days Closed</span>
        <span>Day {state.maxDays}</span>
      </div>
    </div>
  );

  // Live First-Stall Guided Tutorial step (1/5..5/5)
  const tutorialStep = useMemo(() => {
    if (!tutorialActive) return null;
    const hasLeasedOrBuilt = Object.values(state.plots).some((p) => p !== 'empty');
    const hasSupplies =
      (state.stallKits >= 1 || state.ownedStands >= 1) &&
      state.pitchers >= 1 &&
      state.cupsInStock >= 1;
    if (!hasLeasedOrBuilt) {
      return {
        num: 1,
        title: 'Lease a corner',
        text: 'Walk to the gold FOR LEASE plot and press [E] to sign your first lease ($2/day).',
      };
    }
    if (!hasSupplies && neighborhoodId !== 'market') {
      return {
        num: 2,
        title: 'Visit Market',
        text: 'Press [M] (NY Map) and take the subway to Union Square Supply Market.',
      };
    }
    if (!hasSupplies) {
      return {
        num: 3,
        title: 'Buy Supplies',
        text: 'Buy a Stall Kit ($12), Pitcher ($10), and Lemons ($5) from the 3 Market stalls.',
      };
    }
    if (state.ownedStands === 0) {
      return {
        num: 4,
        title: 'Build Stand',
        text: `Head back to ${lastBusinessDistrict.shortName} ([M]), walk to your green LEASED plot, and press [E] to place your stand!`,
      };
    }
    return {
      num: 5,
      title: 'Brew & Serve',
      text: 'Press [E] behind your counter, hit [F] / Brew (nail the gold sweet spot!), and press [Space] to serve your first customer!',
    };
  }, [
    tutorialActive,
    state.plots,
    state.stallKits,
    state.ownedStands,
    state.pitchers,
    state.cupsInStock,
    neighborhoodId,
    lastBusinessDistrict.shortName,
  ]);

  return (
    <div className="game-stage">
      {/* 3D HD-2D Canvas */}
      <div ref={mountRef} className="game-canvas-mount" />

      {/* Top HUD (Chunky Growtopia Game Chrome) */}
      <header className="top-hud">
        {/* Left: Founder & District Crest */}
        <div className="career-crest">
          <button
            type="button"
            className="crest-avatar-btn"
            onClick={() => setFounderModalOpen(true)}
            title={`Founder: ${selectedFounder.name} (${selectedFounder.title}) — Click to switch`}
            aria-label="Choose Your Founder"
          >
            <img
              src={portraits[founderSpecies]}
              alt={selectedFounder.name}
              className="crest-avatar-img pixel-portrait"
            />
          </button>
          <div className="crest-meta">
            <div className="crest-row">
              <span className="crest-location">{neighborhood.shortName}</span>
              <span className="crest-day game-num">
                <img src={icons.sun} alt="" className="px-icon-sm" />
                <span>
                  Day {state.day}/{state.maxDays} · {clockLabel}
                </span>
              </span>
              <button
                type="button"
                className={`clock-speed-btn game-num ${clockSpeed === 2 ? 'is-fast' : ''}`}
                onClick={() => {
                  soundEngine.playClick();
                  setClockSpeed((s) => (s === 1 ? 2 : 1));
                }}
                title="Toggle Day Clock Speed (1x = 120s, 2x = 60s)"
                aria-label={`Clock Speed ${clockSpeed}x`}
              >
                {clockSpeed}x
              </button>
            </div>
            <div
              className="crest-progress-track"
              aria-label={`Day ${state.day} Clock ${clockLabel}`}
            >
              <div className="crest-progress-fill" style={{ width: `${dayClockPct}%` }} />
            </div>
          </div>
        </div>

        {/* Right: Compact Value/Rating Ticker + Action Buttons */}
        <div className="top-hud-right">
          <div className="finance-ticker">
            <div className="ticker-stat" title="Cumulative Value Created (EVA)">
              <div>
                <div className="ticker-label">Value Created</div>
                <div
                  className={`ticker-value game-num ${
                    state.totalValueCreated >= 0 ? 'positive' : 'negative'
                  }`}
                >
                  {fmtSignedMoney(state.totalValueCreated)}
                </div>
              </div>
            </div>
            <div className="ticker-stat" title="Customer Satisfaction Rating">
              <div>
                <div className="ticker-label">Rating</div>
                <div className="ticker-value game-num" style={{ color: 'var(--accent-gold)' }}>
                  ★ {state.ratingAvg.toFixed(1)} ({state.reviews.length})
                </div>
              </div>
            </div>
          </div>

          <div className="hud-actions">
            <button
              type="button"
              className={`gbtn ${muted ? 'gbtn-slate' : ''}`}
              onClick={handleToggleSound}
              title={muted ? 'Unmute game audio' : 'Mute game audio'}
              aria-label={muted ? 'Sound Off' : 'Sound On'}
            >
              <span>{muted ? 'Sound Off' : 'Sound On'}</span>
            </button>
            <button
              type="button"
              className={`gbtn gbtn-green ${mapOpen ? 'is-active' : ''}`}
              onClick={() => {
                soundEngine.playClick();
                setMapOpen((v) => !v);
              }}
            >
              <img src={icons.map} alt="" className="px-icon-sm" />
              <span>NY Map</span>
              <span className="keycap">M</span>
            </button>
            <button
              type="button"
              className={`gbtn ${booksOpen ? 'is-active' : ''}`}
              onClick={() => {
                soundEngine.playClick();
                setBooksOpen((v) => !v);
              }}
            >
              <img src={icons.book} alt="" className="px-icon-sm" />
              <span>Books</span>
              <span className="keycap">B</span>
            </button>
          </div>
        </div>
      </header>

      {/* First-Stall Guided Tutorial Banner (top-center, non-blocking) */}
      {tutorialStep && !founderModalOpen && !mapOpen && !activeModal && !eodRecord && (
        <div className="tutorial-banner" role="status" aria-live="polite">
          <span className="tutorial-step-count game-num">{tutorialStep.num}/5</span>
          <div className="tutorial-copy">
            <strong>{tutorialStep.title}:</strong> {tutorialStep.text}
          </div>
          <button
            type="button"
            className="tutorial-skip-btn"
            onClick={() => {
              soundEngine.playClick();
              setTutorialActive(false);
            }}
          >
            Skip Tutorial
          </button>
        </div>
      )}

      {/* In-World Floating [E] Interaction Prompts */}
      {anchors.nearby === 'own-stand' && noOverlayOpen && (
        <button
          type="button"
          className="world-prompt"
          onClick={enterStand}
          style={{ left: anchors.ownStand.x, top: anchors.ownStand.y - 12 }}
        >
          <span className="keycap">E</span>
          <span>Work Behind Counter (${state.pricePerCup}/cup)</span>
        </button>
      )}

      {anchors.nearby === 'seller-stand' && noOverlayOpen && (
        <button
          type="button"
          className="world-prompt seller"
          onClick={() => setActiveModal('seller-stand')}
          style={{ left: anchors.sellerStand.x, top: anchors.sellerStand.y - 12 }}
        >
          <span className="keycap">E</span>
          <span>Inspect Seller Stand · Ask ${SELLER_ASK}</span>
        </button>
      )}

      {anchors.nearby === 'plot-lease' && noOverlayOpen && (
        <button
          type="button"
          className="world-prompt"
          onClick={() => setActiveModal('plot-lease')}
          style={{ left: anchors.ownStand.x, top: anchors.ownStand.y - 12 }}
        >
          <span className="keycap">E</span>
          <span>
            {currentPlotStatus === 'leased'
              ? state.stallKits >= 1
                ? 'Build Stand Here (1 Kit)'
                : 'Leased Plot · Needs Stall Kit ($12)'
              : `Sign Lease ($${neighborhood.dailyRent}/day)`}
          </span>
        </button>
      )}

      {/* Always-Visible Floating Overhead Sign Pills for All 3 Union Square Market Stalls */}
      {neighborhoodId === 'market' && noOverlayOpen && (
        <>
          <button
            type="button"
            className={`market-sign-pill ${anchors.nearby === 'market-stalls' ? 'is-nearby' : ''}`}
            onClick={() => {
              soundEngine.playClick();
              setActiveModal('market-stalls');
            }}
            style={{
              left: anchors.marketAnchors.stalls.x,
              top: anchors.marketAnchors.stalls.y - 10,
            }}
          >
            {anchors.nearby === 'market-stalls' && <span className="keycap">E</span>}
            <img src={icons.market} alt="" className="px-icon-sm" />
            <span>Stall Kits · $12</span>
          </button>

          <button
            type="button"
            className={`market-sign-pill ${anchors.nearby === 'market-pitchers' ? 'is-nearby' : ''}`}
            onClick={() => {
              soundEngine.playClick();
              setActiveModal('market-pitchers');
            }}
            style={{
              left: anchors.marketAnchors.pitchers.x,
              top: anchors.marketAnchors.pitchers.y - 10,
            }}
          >
            {anchors.nearby === 'market-pitchers' && <span className="keycap">E</span>}
            <img src={icons.pitcher} alt="" className="px-icon-sm" />
            <span>Glass Pitchers · $10</span>
          </button>

          <button
            type="button"
            className={`market-sign-pill ${anchors.nearby === 'market-lemons' ? 'is-nearby' : ''}`}
            onClick={() => {
              soundEngine.playClick();
              setActiveModal('market-lemons');
            }}
            style={{
              left: anchors.marketAnchors.lemons.x,
              top: anchors.marketAnchors.lemons.y - 10,
            }}
          >
            {anchors.nearby === 'market-lemons' && <span className="keycap">E</span>}
            <img src={icons.lemon} alt="" className="px-icon-sm" />
            <span>Fresh Lemons · $5</span>
          </button>
        </>
      )}

      {/* In-World Customer Queue Patience Bars */}
      {anchors.queue.map((cust) => {
        const pct = Math.max(0, Math.min(100, Math.round(cust.patienceRatio * 100)));
        const barColor =
          cust.patienceRatio > 0.55
            ? '#5fd16d'
            : cust.patienceRatio > 0.28
            ? '#ffe066'
            : '#ff6b6b';
        return (
          <div
            key={cust.id}
            className="patience-anchor"
            style={{ left: cust.x, top: cust.y - 6 }}
          >
            {cust.isFront && <span className="patience-next-tag">Next</span>}
            <div className="patience-track">
              <div
                className="patience-fill"
                style={{ width: `${pct}%`, background: barColor }}
              />
            </div>
          </div>
        );
      })}

      {/* Escalating Sale Pop-Numbers & Perfect Brew Bursts */}
      {salePops.map((pop, idx) => {
        const fontSize = pop.isPerfect ? 18 : Math.min(24, 15 + (pop.combo - 1) * 2);
        const popClass = pop.isPerfect
          ? 'sale-pop is-perfect game-num'
          : pop.combo >= 4
          ? 'sale-pop is-fire game-num'
          : pop.combo >= 2
          ? 'sale-pop is-hot game-num'
          : 'sale-pop game-num';
        return (
          <div
            key={pop.id}
            className={popClass}
            style={{
              left: anchors.ownStand.x,
              top: anchors.ownStand.y - 76 - idx * 24,
              fontSize,
            }}
          >
            {pop.text}
          </div>
        );
      })}

      {/* In-World Floating Accounting Toasts */}
      {toasts.map((t, idx) => {
        const pt = t.anchor === 'own-stand' ? anchors.ownStand : anchors.sellerStand;
        return (
          <div
            key={t.id}
            className={`ledger-toast ${t.tone} game-num`}
            style={{
              left: pt.x,
              top: pt.y - 46 - idx * 30,
            }}
          >
            <span>{t.text}</span>
          </div>
        );
      })}

      {/* Bottom Area: Stall Workbench Bar (when INSIDE stand) OR Action Dock */}
      <div className="bottom-dock-wrap">
        {workingAtStand ? (
          <div className="workbench-bar" role="region" aria-label="Stall Workbench">
            {/* Hero Cash Counter (stays visible while serving!) */}
            <div
              key={`wb-cash-${cashPulseKey}`}
              className={`dock-cash-hero is-compact ${cashPulseKey > 0 ? 'is-cash-pulse' : ''}`}
              title="Available Cash"
            >
              <img src={icons.coin} alt="Cash" className="px-icon-hero" />
              <span className="dock-cash-val game-num">${state.cash.toFixed(2)}</span>
            </div>

            {/* Step 1: 4-Challenge Rotating Arcade Brew Mini-Game */}
            <div className="workbench-step" style={{ minWidth: 232 }}>
              <div className="wb-step-head">
                <span className="wb-step-badge">
                  {brewGameActive
                    ? brewKind === 'triple-squeeze'
                      ? `TRIPLE SQUEEZE (${tripleHits}/3)`
                      : brewKind === 'keep-in-tube'
                      ? `KEEP IN TUBE! ${Math.round(tubeFill * 100)}%`
                      : brewKind === 'rapid-stir'
                      ? `RAPID STIR! (${stirIndex}/5)`
                      : 'MOVING BULLSEYE!'
                    : 'Step 1 · Brew'}
                </span>
                <span className="wb-step-meta game-num">
                  {brewedCups}/{state.cupsInStock} ready
                </span>
              </div>

              {brewGameActive ? (
                brewKind === 'triple-squeeze' ? (
                  <div className="wb-skill-gauge" aria-label="Triple Squeeze timing gauge">
                    {tripleTargets.map((tCenter, idx) => {
                      const tHalf = Math.min(
                        0.11,
                        0.068 + Math.max(0, state.pitchers - 1) * 0.012 + state.workers * 0.015
                      );
                      const isCurrent = idx === tripleStep;
                      const isDone = idx < tripleStep;
                      return (
                        <div
                          key={idx}
                          className={isCurrent ? 'wb-skill-perfect' : 'wb-skill-good'}
                          style={{
                            left: `${tCenter * 100}%`,
                            width: `${tHalf * 200}%`,
                            opacity: isDone ? 0.25 : 1,
                          }}
                        />
                      );
                    })}
                    <div className="wb-skill-needle" style={{ left: `${brewNeedlePos * 100}%` }} />
                  </div>
                ) : brewKind === 'keep-in-tube' ? (
                  <div className="wb-skill-gauge" aria-label="Keep in Tube pressure gauge">
                    <div
                      className="wb-skill-perfect"
                      style={{
                        left: `${tubeCenter * 100}%`,
                        width: `${tubeWidth * 100}%`,
                      }}
                    />
                    <div
                      className="wb-tube-drop"
                      style={{ left: `${tubeDrop * 100}%` }}
                      title="Lemon Drop"
                    />
                  </div>
                ) : brewKind === 'rapid-stir' ? (
                  <div className={`wb-stir-wrap ${stirShake ? 'is-shake' : ''}`}>
                    <div className="wb-stir-keys game-num">
                      {stirSeq.map((k, idx) => (
                        <span
                          key={idx}
                          className={`wb-stir-key ${
                            idx < stirIndex ? 'is-done' : idx === stirIndex ? 'is-active' : ''
                          }`}
                        >
                          {k === 'SPACE' ? '␣' : k}
                        </span>
                      ))}
                    </div>
                    <div className="wb-timer-track">
                      <div
                        className="wb-timer-fill is-brew"
                        style={{ width: `${Math.round(stirFuse * 100)}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="wb-skill-gauge" aria-label="Counter-Moving Bullseye gauge">
                    <div
                      className="wb-skill-good"
                      style={{
                        left: `${bullseyePos * 100}%`,
                        width: `${goodHalf * 200}%`,
                      }}
                    />
                    <div
                      className="wb-skill-perfect"
                      style={{
                        left: `${bullseyePos * 100}%`,
                        width: `${perfectHalf * 200}%`,
                      }}
                    />
                    <div className="wb-skill-needle" style={{ left: `${brewNeedlePos * 100}%` }} />
                  </div>
                )
              ) : (
                <div className="wb-brew-track">
                  <div className="wb-brew-fill" style={{ width: `${brewPct}%` }} />
                </div>
              )}

              {brewGameActive ? (
                <button
                  type="button"
                  className="gbtn gbtn-gold"
                  onPointerDown={() => {
                    if (brewKind === 'keep-in-tube') {
                      spaceHeldRef.current = true;
                    }
                  }}
                  onPointerUp={() => {
                    spaceHeldRef.current = false;
                  }}
                  onPointerLeave={() => {
                    spaceHeldRef.current = false;
                  }}
                  onClick={lockBrewGame}
                  style={{ padding: '6px 10px', fontSize: 12 }}
                >
                  <span>
                    {brewKind === 'keep-in-tube'
                      ? 'HOLD / TAP THRUST!'
                      : brewKind === 'rapid-stir'
                      ? `STIR [${stirSeq[stirIndex] ?? 'SPACE'}]`
                      : brewKind === 'triple-squeeze'
                      ? `SQUEEZE (${tripleStep + 1}/3)!`
                      : 'SQUEEZE!'}
                  </span>
                  <span className="keycap">
                    {brewKind === 'rapid-stir' ? stirSeq[stirIndex] ?? 'Space' : 'Space'}
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className="gbtn gbtn-gold"
                  onClick={startBrewGame}
                  disabled={state.cupsInStock <= 0 || brewedCups >= state.cupsInStock}
                  style={{ padding: '6px 10px', fontSize: 12 }}
                >
                  <img src={icons.lemon} alt="" className="px-icon-sm" />
                  <span>
                    {state.pitchers < 1
                      ? 'Need Pitcher!'
                      : state.cupsInStock <= 0
                      ? 'Out of Lemons!'
                      : 'Brew Pitcher'}
                  </span>
                  <span className="keycap">F</span>
                </button>
              )}
            </div>

            {/* Step 2: Serve Front Customer [Space] */}
            <div className="workbench-step" style={{ minWidth: 212 }}>
              <div className="wb-step-head">
                <span className="wb-step-badge">Step 2 · Serve</span>
                {combo >= 2 ? (
                  <span key={`combo-${combo}`} className="wb-combo-badge game-num">
                    🔥 x{combo} STREAK
                  </span>
                ) : (
                  <span className="wb-step-meta game-num">Queue: {anchors.queue.length}/4</span>
                )}
              </div>
              <div className="wb-timer-track">
                <div
                  className="wb-timer-fill"
                  style={{ width: `${serveProgress !== null ? Math.round(serveProgress * 100) : 0}%` }}
                />
              </div>
              <button
                type="button"
                className="gbtn gbtn-green"
                onClick={startServeFrontCustomer}
                disabled={brewedCups < 1 || anchors.queue.length === 0 || serveProgress !== null}
                style={{ padding: '6px 10px', fontSize: 12 }}
              >
                <span>
                  {serveProgress !== null
                    ? 'Pouring...'
                    : anchors.queue.length === 0
                    ? 'Waiting for Line'
                    : 'Serve Next Customer'}
                </span>
                <span className="keycap">Space</span>
              </button>
            </div>

            {/* Step 3: Set Price & Stand Controls */}
            <div className="workbench-step">
              <div className="wb-step-head">
                <span className="wb-step-badge">Step 3 · Price</span>
                <span className="wb-step-meta">{neighborhood.shortName}</span>
              </div>
              <div className="wb-price-row">
                {[2, 3, 4, 5].map((price) => {
                  const pct = Math.round(
                    getConversionProb(price, neighborhood.priceSensitivity) * 100
                  );
                  return (
                    <button
                      key={price}
                      type="button"
                      className={`wb-price-btn ${state.pricePerCup === price ? 'is-selected' : ''}`}
                      onClick={() => {
                        soundEngine.playClick();
                        setState((prev) => ({ ...prev, pricePerCup: price }));
                      }}
                    >
                      <span className="wb-price-num game-num">${price}</span>
                      <span className="wb-price-pct game-num">{pct}%</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 4: Staffing (Workers & Autonomous Managers) */}
            <div className="workbench-step" style={{ minWidth: 162 }}>
              <div className="wb-step-head">
                <span className="wb-step-badge">Staff</span>
                <span className="wb-step-meta game-num">-${dailyWages}/d</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <button
                  type="button"
                  className="gbtn"
                  onClick={hireWorker}
                  style={{ padding: '5px 8px', fontSize: 11 }}
                  title="Widens the brew timing sweet spot (+$3/day wages)"
                >
                  <span>
                    Worker (${WORKER_DAILY_WAGE}/d){state.workers > 0 ? ` ×${state.workers}` : ''}
                  </span>
                </button>
                <button
                  type="button"
                  className="gbtn gbtn-green"
                  onClick={hireManager}
                  style={{ padding: '5px 8px', fontSize: 11 }}
                  title="Auto-brews & serves queued customers (+$5/day wages)"
                >
                  <span>
                    Manager (${MANAGER_DAILY_WAGE}/d){state.managers > 0 ? ` ×${state.managers}` : ''}
                  </span>
                </button>
              </div>
            </div>

            {/* Quick Exit / Market / Divest */}
            <div className="workbench-step" style={{ justifyContent: 'center', gap: 5 }}>
              <button
                type="button"
                className="gbtn gbtn-green"
                onClick={() => handleSelectNeighborhood('market')}
                style={{ padding: '5px 10px', fontSize: 11.5 }}
              >
                <img src={icons.market} alt="" className="px-icon-sm" />
                <span>Market →</span>
              </button>
              <div style={{ display: 'flex', gap: 5 }}>
                <button
                  type="button"
                  className="gbtn gbtn-slate"
                  onClick={exitStand}
                  style={{ padding: '5px 9px', fontSize: 11, flex: 1 }}
                >
                  Step Out
                </button>
                <button
                  type="button"
                  className="gbtn gbtn-red"
                  onClick={divestCurrentStand}
                  style={{ padding: '5px 8px', fontSize: 11 }}
                  title="Liquidate this stand at 70% salvage value (+$8.40 Cash, -$12.00 Equip, -$0.60/d Hurdle)"
                >
                  Divest (+$8.40)
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="action-dock">
              {/* Hero Cash Anchor */}
              <div
                key={`cash-${cashPulseKey}`}
                className={`dock-cash-hero ${cashPulseKey > 0 ? 'is-cash-pulse' : ''}`}
                title="Available Cash"
              >
                <img src={icons.coin} alt="Cash" className="px-icon-hero" />
                <span className="dock-cash-val game-num">${state.cash.toFixed(2)}</span>
              </div>

              <div
                className={`dock-slot ${state.cupsInStock === 0 ? 'is-low' : ''}`}
                title={`Lemons in Stock (${state.cupsInStock} cups)`}
              >
                <img src={icons.lemon} alt="Lemons" className="px-icon-dock" />
                <span className="dock-val game-num">{state.cupsInStock}</span>
              </div>

              <div className="dock-slot" title={`Cup Price ($${state.pricePerCup}/cup)`}>
                <span className="dock-price-tag game-num">${state.pricePerCup}</span>
                <span className="dock-price-sub">/cup</span>
              </div>

              <div className="dock-slot" title={`Glass Pitchers (${state.pitchers})`}>
                <img src={icons.pitcher} alt="Pitchers" className="px-icon-dock" />
                <span className="dock-val game-num">{state.pitchers}</span>
              </div>

              {state.stallKits > 0 && (
                <div className="dock-slot" title={`Wooden Stall Kits (${state.stallKits})`}>
                  <img src={icons.market} alt="Stall Kits" className="px-icon-dock" />
                  <span className="dock-val game-num">{state.stallKits}</span>
                </div>
              )}

              {anchors.nearby === 'plot-lease' && (
                <button
                  type="button"
                  className="gbtn gbtn-gold"
                  onClick={() => setActiveModal('plot-lease')}
                >
                  <span className="keycap">E</span>
                  <span>
                    {currentPlotStatus === 'leased'
                      ? state.stallKits >= 1
                        ? 'Build Stand Here'
                        : 'Get Stall Kit ($12)'
                      : `Sign Lease ($${neighborhood.dailyRent}/d)`}
                  </span>
                </button>
              )}

              {anchors.nearby === 'own-stand' && (
                <button type="button" className="gbtn gbtn-gold" onClick={enterStand}>
                  <span className="keycap">E</span>
                  <span>Step Inside Stand</span>
                </button>
              )}

              {anchors.nearby === 'seller-stand' && (
                <button
                  type="button"
                  className="gbtn"
                  onClick={() => setActiveModal('seller-stand')}
                >
                  <span className="keycap">E</span>
                  <span>Inspect Seller</span>
                </button>
              )}

              {anchors.nearby === 'market-stalls' && (
                <button
                  type="button"
                  className="gbtn gbtn-green"
                  onClick={() => setActiveModal('market-stalls')}
                >
                  <span className="keycap">E</span>
                  <span>Buy Stall Kit ($12)</span>
                </button>
              )}

              {anchors.nearby === 'market-lemons' && (
                <button
                  type="button"
                  className="gbtn gbtn-green"
                  onClick={() => setActiveModal('market-lemons')}
                >
                  <span className="keycap">E</span>
                  <span>Buy Lemons ($5)</span>
                </button>
              )}

              {anchors.nearby === 'market-pitchers' && (
                <button
                  type="button"
                  className="gbtn gbtn-green"
                  onClick={() => setActiveModal('market-pitchers')}
                >
                  <span className="keycap">E</span>
                  <span>Buy Pitchers ($10)</span>
                </button>
              )}

              {neighborhoodId === 'market' && !anchors.nearby && (
                <button
                  type="button"
                  className="gbtn gbtn-gold"
                  onClick={() => handleSelectNeighborhood(lastBusinessNeighborhood)}
                >
                  <span>Back to {lastBusinessDistrict.shortName} →</span>
                </button>
              )}
            </div>

            {!anchors.nearby && !tutorialStep && (
              <div className="dock-hint">
                {neighborhoodId === 'market'
                  ? 'Walk to the Lemon Stall (right) or Gear Stall (left) and press [E]'
                  : 'WASD / Click to walk · Press [E] at your stand to step behind the counter · [M] Map'}
              </div>
            )}
          </>
        )}
      </div>

      {/* Books Drawer (Financial Statements) */}
      {booksOpen && (
        <aside className="books-drawer" aria-label="Financial Statements">
          <div className="drawer-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <img src={icons.book} alt="" className="px-icon" />
              <div>
                <div className="drawer-kicker">
                  General Ledger · {neighborhood.shortName} · Day {state.day}
                </div>
                <div className="drawer-title">Financial Statements</div>
              </div>
            </div>
            <button
              type="button"
              className="icon-close-btn"
              onClick={() => setBooksOpen(false)}
              aria-label="Close Books"
            >
              ✕
            </button>
          </div>

          <div className="drawer-body">
            {/* Income Statement */}
            <div className="ledger-section">
              <div className="ledger-section-head">
                <span>Income Statement</span>
                <span>Day {state.day} Live</span>
              </div>
              <div className="ledger-row">
                <span>Revenue</span>
                <span className="game-num val-pos">${state.dayRevenue.toFixed(2)}</span>
              </div>
              <div className="ledger-row">
                <span>COGS (Lemons)</span>
                <span className="game-num val-neg">-${state.dayCogs.toFixed(2)}</span>
              </div>
              <div className="ledger-row">
                <span>Live NOPAT (pre-rent)</span>
                <span className="game-num">${liveNopat.toFixed(2)}</span>
              </div>
              <div className="ledger-row">
                <span>Est. Daily Plot Rent</span>
                <span className="game-num val-neg">-${estRent.toFixed(2)}</span>
              </div>
              {dailyWages > 0 && (
                <div className="ledger-row">
                  <span>
                    Staff Wages ({state.workers}W · {state.managers}M)
                  </span>
                  <span className="game-num val-neg">-${dailyWages.toFixed(2)}</span>
                </div>
              )}
              <div className="ledger-row is-total">
                <span>Projected Day NOPAT</span>
                <span className={`game-num ${projectedNopat >= 0 ? 'val-pos' : 'val-neg'}`}>
                  {fmtSignedMoney(projectedNopat)}
                </span>
              </div>
            </div>

            {/* Balance Sheet */}
            <div className="ledger-section">
              <div className="ledger-section-head">
                <span>Balance Sheet</span>
                <span>Position</span>
              </div>
              <div className="ledger-row">
                <span>Cash</span>
                <span className="game-num">${state.cash.toFixed(2)}</span>
              </div>
              <div className="ledger-row">
                <span>Inventory (Lemons)</span>
                <span className="game-num">${state.inventoryValue.toFixed(2)}</span>
              </div>
              <div className="ledger-row">
                <span>Equipment (Stands &amp; Pitchers)</span>
                <span className="game-num">${state.equipmentValue.toFixed(2)}</span>
              </div>
              <div className="ledger-row is-total">
                <span>Total Assets</span>
                <span className="game-num">${totalAssets.toFixed(2)}</span>
              </div>
              <div className="ledger-row">
                <span>Owner&apos;s Equity</span>
                <span className="game-num">${totalEquity.toFixed(2)}</span>
              </div>
              <div className="balance-check-pill game-num">
                <span>{isBalanced ? '✓' : '!'}</span>
                <span>
                  {isBalanced
                    ? `Balanced: Assets ($${totalAssets.toFixed(2)}) = Equity ($${totalEquity.toFixed(2)})`
                    : 'Out of Balance'}
                </span>
              </div>
            </div>

            {/* Capital Allocation & NOPAT vs 5% Hurdle Meter */}
            <div className="ledger-section">
              <div className="ledger-section-head">
                <span>Capital Hurdle (EVA)</span>
                <span>{(HURDLE_RATE * 100).toFixed(0)}% / Day</span>
              </div>
              <div className="ledger-row">
                <span>Invested Operating Capital</span>
                <span className="game-num">${investedCap.toFixed(2)}</span>
              </div>
              <div className="ledger-row">
                <span>5% Daily Hurdle Charge</span>
                <span className="game-num val-amber">-${dailyHurdle.toFixed(2)}/d</span>
              </div>

              <div className="hurdle-meter-box">
                <div className="hurdle-meter-top">
                  <span>NOPAT vs. 5% Hurdle</span>
                  <span className={clearsHurdle ? 'val-pos' : 'val-amber'}>
                    {clearsHurdle ? 'Clearing Hurdle!' : 'Below Hurdle'}
                  </span>
                </div>
                <div className="hurdle-meter-track">
                  <div
                    className="hurdle-meter-fill"
                    style={{
                      width: `${nopatFillPct}%`,
                      background: clearsHurdle
                        ? 'linear-gradient(180deg, #5fd16d, #298438)'
                        : 'linear-gradient(180deg, #f5a623, #d96b14)',
                    }}
                  />
                  <div
                    className="hurdle-meter-marker"
                    style={{ left: `${hurdleMarkerPct}%` }}
                    title={`5% Hurdle: $${dailyHurdle.toFixed(2)}`}
                  />
                </div>
                <div className="hurdle-meter-foot game-num">
                  <span>NOPAT {fmtSignedMoney(projectedNopat)}</span>
                  <span>EVA {fmtSignedMoney(projectedEva)}</span>
                </div>
              </div>

              <div className="ledger-row is-total" style={{ marginTop: 9 }}>
                <span>Cumulative Value Created</span>
                <span className={`game-num ${state.totalValueCreated >= 0 ? 'val-pos' : 'val-neg'}`}>
                  {fmtSignedMoney(state.totalValueCreated)}
                </span>
              </div>
              {renderValueTrajectoryStrip()}

              {(state.pitchers >= 1 || (currentPlotStatus === 'built' && state.ownedStands >= 1)) && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  {state.pitchers >= 1 && (
                    <button
                      type="button"
                      className="gbtn gbtn-slate"
                      style={{ flex: 1, padding: '6px 8px', fontSize: 11 }}
                      onClick={sellUsedPitcher}
                      title="70% salvage value: Cash +$7, Equip -$10, lowers 5% hurdle by -$0.50/day"
                    >
                      Sell Pitcher (+$7)
                    </button>
                  )}
                  {currentPlotStatus === 'built' && state.ownedStands >= 1 && (
                    <button
                      type="button"
                      className="gbtn gbtn-red"
                      style={{ flex: 1, padding: '6px 8px', fontSize: 11 }}
                      onClick={divestCurrentStand}
                      title="70% salvage value: Cash +$8.40, Equip -$12, lowers 5% hurdle by -$0.60/day"
                    >
                      Divest Stand (+$8.40)
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Latest Customer Reviews */}
            <div className="ledger-section">
              <div className="ledger-section-head">
                <span>Customer Reviews</span>
                <span className="game-num" style={{ color: 'var(--accent-gold)' }}>
                  ★ {state.ratingAvg.toFixed(1)} ({state.reviews.length})
                </span>
              </div>
              {state.reviews.length === 0 ? (
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '4px 0' }}>
                  No reviews yet — step behind your counter and serve queued customers!
                </div>
              ) : (
                <div className="review-list">
                  {state.reviews
                    .slice(-4)
                    .reverse()
                    .map((rev) => (
                      <div key={rev.id} className="review-item">
                        <div className="review-stars">
                          {'★'.repeat(rev.stars)}
                          {'☆'.repeat(5 - rev.stars)}
                        </div>
                        <div className="review-comment">{rev.comment}</div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </aside>
      )}

      {/* Union Square Supply Market — Lemon Vendor Modal */}
      {activeModal === 'market-lemons' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-shell" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src={icons.lemon} alt="" className="px-icon-lg" />
                <div>
                  <div className="modal-kicker">Union Square Supply Market · Wholesale</div>
                  <div className="modal-title">Leo&apos;s Fresh Lemon Stall</div>
                </div>
              </div>
              <button
                type="button"
                className="icon-close-btn"
                onClick={() => setActiveModal(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="seller-intro">
                <div className="seller-avatar">
                  <img
                    src={portraits.panda}
                    alt="Leo the Lemon Vendor"
                    className="seller-avatar-img pixel-portrait"
                  />
                </div>
                <div className="speech-bubble">
                  <div className="speech-bubble-meta">
                    <span className="seller-name">Leo · Lemon Wholesaler</span>
                    <span className="ask-badge game-num">Cash: ${state.cash.toFixed(2)}</span>
                  </div>
                  &ldquo;Fresh crates straight off the truck! Grab a crate of 10 cups for $5 — remember, buying
                  inventory swaps Cash for Stock with zero instant profit hit.&rdquo;
                </div>
              </div>

              <div className="vendor-card">
                <div className="vendor-card-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div className="vendor-icon-box">
                      <img src={icons.lemon} alt="" className="px-icon-lg" />
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 900 }}>Crate of Fresh Lemons</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                        +10 cups ($0.50 COGS/cup) · Currently holding {state.cupsInStock} cups
                      </div>
                    </div>
                  </div>
                  <span className="vendor-price-badge game-num">$5</span>
                </div>

                <div className="impact-list">
                  <div className="impact-line">
                    <span>Balance Sheet</span>
                    <span className="game-num">Cash -$5 → Inventory +$5</span>
                  </div>
                  <div className="impact-line">
                    <span>Immediate P&amp;L Hit</span>
                    <span className="game-num val-pos">$0.00</span>
                  </div>
                  <div className="impact-line">
                    <span>5% Daily Hurdle Impact</span>
                    <span className="game-num val-amber">+$0.25/day</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="gbtn gbtn-green"
                    style={{ flex: 1 }}
                    onClick={buyLemons}
                    disabled={state.cash < 5}
                  >
                    <img src={icons.lemon} alt="" className="px-icon-sm" />
                    <span>Buy Lemon Crate ($5)</span>
                  </button>
                  <button
                    type="button"
                    className="gbtn gbtn-gold"
                    onClick={() => handleSelectNeighborhood(lastBusinessNeighborhood)}
                  >
                    Back to {lastBusinessDistrict.shortName} →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Marked Sidewalk Plot — Sign Lease / Build Stand Modal */}
      {activeModal === 'plot-lease' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-shell" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src={icons.map} alt="" className="px-icon-lg" />
                <div>
                  <div className="modal-kicker">
                    {neighborhood.name} · {currentPlotStatus === 'leased' ? 'Leased Plot' : 'For Lease'}
                  </div>
                  <div className="modal-title">
                    {currentPlotStatus === 'leased'
                      ? 'Ready to Place Lemonade Stand'
                      : 'Sign Sidewalk Plot Lease'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="icon-close-btn"
                onClick={() => setActiveModal(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="vendor-card">
                <div className="vendor-card-head">
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 900 }}>{neighborhood.name} Corner</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                      {neighborhood.crowdLabel} · Typical price {neighborhood.typicalPrice}
                    </div>
                  </div>
                  <span className="vendor-price-badge game-num">${neighborhood.dailyRent}/day</span>
                </div>

                <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--text-soft)' }}>
                  {neighborhood.description}
                </div>

                <div className="impact-list">
                  <div className="impact-line">
                    <span>Plot Status</span>
                    <span className="game-num">
                      {currentPlotStatus === 'leased' ? 'LEASED (Ready for Stall Kit)' : 'EMPTY (For Lease)'}
                    </span>
                  </div>
                  <div className="impact-line">
                    <span>Daily Lease Rent</span>
                    <span className="game-num val-amber">-${neighborhood.dailyRent}.00/day</span>
                  </div>
                  <div className="impact-line">
                    <span>Stall Kits in Inventory</span>
                    <span className="game-num">{state.stallKits}</span>
                  </div>
                </div>

                {currentPlotStatus === 'empty' ? (
                  <button type="button" className="gbtn gbtn-gold" onClick={signLease}>
                    <span>Sign Lease (${neighborhood.dailyRent}/day)</span>
                  </button>
                ) : state.stallKits >= 1 ? (
                  <button type="button" className="gbtn gbtn-green" onClick={buildStandOnPlot}>
                    <span>Build Stand Here (Uses 1 Stall Kit)</span>
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-gold)' }}>
                      You need a Wooden Stall Kit (${STALL_KIT_COST}) from Union Square Supply Market to
                      build here.
                    </div>
                    <button
                      type="button"
                      className="gbtn gbtn-green"
                      onClick={() => handleSelectNeighborhood('market')}
                    >
                      <img src={icons.market} alt="" className="px-icon-sm" />
                      <span>Go to Union Square Supply Market →</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Union Square Supply Market — Left Stall: Carpentry & Stall Kits Vendor Modal */}
      {activeModal === 'market-stalls' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-shell" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src={icons.market} alt="" className="px-icon-lg" />
                <div>
                  <div className="modal-kicker">Union Square Supply Market · Carpentry Stall</div>
                  <div className="modal-title">Claire&apos;s Wooden Stall Kits</div>
                </div>
              </div>
              <button
                type="button"
                className="icon-close-btn"
                onClick={() => setActiveModal(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="seller-intro">
                <div className="seller-avatar">
                  <img
                    src={portraits.bunny}
                    alt="Claire the Carpentry Vendor"
                    className="seller-avatar-img pixel-portrait"
                  />
                </div>
                <div className="speech-bubble">
                  <div className="speech-bubble-meta">
                    <span className="seller-name">Claire · Carpentry Wholesaler</span>
                    <span className="ask-badge game-num">Cash: ${state.cash.toFixed(2)}</span>
                  </div>
                  &ldquo;Hand-built cedar lemonade stands ready to assemble on any leased NYC sidewalk plot!
                  Buying a Stall Kit swaps Cash for Equipment with zero immediate P&amp;L hit.&rdquo;
                </div>
              </div>

              <div className="vendor-card">
                <div className="vendor-card-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div className="vendor-icon-box">
                      <img src={icons.market} alt="" className="px-icon-lg" />
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 900 }}>Wooden Stall Kit</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                        Place on any leased plot · Holding {state.stallKits} kit(s)
                      </div>
                    </div>
                  </div>
                  <span className="vendor-price-badge game-num">${STALL_KIT_COST}</span>
                </div>

                <div className="impact-list">
                  <div className="impact-line">
                    <span>Balance Sheet</span>
                    <span className="game-num">
                      Cash -${STALL_KIT_COST} → Equipment +${STALL_KIT_COST}
                    </span>
                  </div>
                  <div className="impact-line">
                    <span>Immediate P&amp;L Hit</span>
                    <span className="game-num val-pos">$0.00</span>
                  </div>
                  <div className="impact-line">
                    <span>5% Daily Hurdle Impact</span>
                    <span className="game-num val-amber">+$0.60/day</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="gbtn gbtn-green"
                    style={{ flex: 1 }}
                    onClick={buyStallKit}
                    disabled={state.cash < STALL_KIT_COST}
                  >
                    <img src={icons.market} alt="" className="px-icon-sm" />
                    <span>Buy Wooden Stall Kit (${STALL_KIT_COST})</span>
                  </button>
                  <button
                    type="button"
                    className="gbtn gbtn-gold"
                    onClick={() => handleSelectNeighborhood(lastBusinessNeighborhood)}
                  >
                    Back to {lastBusinessDistrict.shortName} →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Union Square Supply Market — Center Stall: Glassware & Pitchers Vendor Modal */}
      {activeModal === 'market-pitchers' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-shell" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src={icons.pitcher} alt="" className="px-icon-lg" />
                <div>
                  <div className="modal-kicker">Union Square Supply Market · Glassware Stall</div>
                  <div className="modal-title">Sam&apos;s Glass Pitchers</div>
                </div>
              </div>
              <button
                type="button"
                className="icon-close-btn"
                onClick={() => setActiveModal(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="seller-intro">
                <div className="seller-avatar">
                  <img
                    src={portraits.penguin}
                    alt="Sam the Pitcher Vendor"
                    className="seller-avatar-img pixel-portrait"
                  />
                </div>
                <div className="speech-bubble">
                  <div className="speech-bubble-meta">
                    <span className="seller-name">Sam · Glassware Wholesaler</span>
                    <span className="ask-badge game-num">Cash: ${state.cash.toFixed(2)}</span>
                  </div>
                  &ldquo;Every stand needs a Glass Pitcher ($10) to brew fresh lemonade, and extra pitchers
                  widen your brew sweet spot! You can also sell used pitchers back at 70% salvage value.&rdquo;
                </div>
              </div>

              <div className="vendor-card">
                <div className="vendor-card-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div className="vendor-icon-box">
                      <img src={icons.pitcher} alt="" className="px-icon-lg" />
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 900 }}>Gleaming Glass Pitcher</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                        Required to brew &amp; widens sweet spot · Own {state.pitchers} pitcher(s)
                      </div>
                    </div>
                  </div>
                  <span className="vendor-price-badge game-num">$10</span>
                </div>

                <div className="impact-list">
                  <div className="impact-line">
                    <span>Balance Sheet</span>
                    <span className="game-num">Cash -$10 → Equipment +$10</span>
                  </div>
                  <div className="impact-line">
                    <span>Immediate P&amp;L Hit</span>
                    <span className="game-num val-pos">$0.00</span>
                  </div>
                  <div className="impact-line">
                    <span>5% Daily Hurdle Impact</span>
                    <span className="game-num val-amber">+$0.50/day</span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="gbtn gbtn-green"
                    style={{ flex: 1 }}
                    onClick={buyPitcher}
                    disabled={state.cash < 10}
                  >
                    <img src={icons.pitcher} alt="" className="px-icon-sm" />
                    <span>Buy Glass Pitcher ($10)</span>
                  </button>
                  {state.pitchers >= 1 && (
                    <button
                      type="button"
                      className="gbtn gbtn-slate"
                      onClick={sellUsedPitcher}
                      title="70% salvage value: Cash +$7, Equip -$10, Hurdle -$0.50/day"
                    >
                      <span>Sell Used Pitcher (+$7)</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="gbtn gbtn-gold"
                    onClick={() => handleSelectNeighborhood(lastBusinessNeighborhood)}
                  >
                    Back to {lastBusinessDistrict.shortName} →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Seller Due Diligence & Sealed-Bid Dossier Modal */}
      {activeModal === 'seller-stand' && (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)}>
          <div className="modal-shell is-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-kicker">Acquisition Dossier · Brownstone Corner</div>
                <div className="modal-title">Seller Stand — Due Diligence &amp; Sealed Bid</div>
              </div>
              <button
                type="button"
                className="icon-close-btn"
                onClick={() => setActiveModal(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              {/* Seller Portrait Badge & Speech Bubble */}
              <div className="seller-intro">
                <div className="seller-avatar">
                  <img
                    src={portraits.shiba}
                    alt="Maya the Seller"
                    className="seller-avatar-img pixel-portrait"
                  />
                </div>
                <div className="speech-bubble">
                  <div className="speech-bubble-meta">
                    <span className="seller-name">Maya · Corner Stand Owner</span>
                    <span className="ask-badge game-num">Asking ${SELLER_ASK}</span>
                  </div>
                  &ldquo;Sales climbed every period—$14, $15, now $16 a day. Lemons held at $5 and rent at
                  $3, so it kept $8 a day last period. Prime brownstone corner. I&apos;m asking ${SELLER_ASK}.&rdquo;
                </div>
              </div>

              {/* 3-Period Operating Table */}
              <div>
                <div className="panel-section-label">
                  <span>Reported Operating History</span>
                  <span>Per Day</span>
                </div>
                <div className="dossier-table-wrap">
                  <table className="dossier-table game-num">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Sales</th>
                        <th>Lemons</th>
                        <th>Manager</th>
                        <th>Rent</th>
                        <th>Profit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SELLER_PERIODS.map((r) => (
                        <tr key={r.period}>
                          <td style={{ fontFamily: 'inherit' }}>{r.period}</td>
                          <td>{r.sales}</td>
                          <td>{r.lemons}</td>
                          <td className="clue-zero">{r.manager}</td>
                          <td>{r.rent}</td>
                          <td className="profit-cell">{r.profit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Diligence Q&A */}
              <div>
                <div className="panel-section-label">
                  <span>Due Diligence Q&amp;A ({3 - qaLog.length} left)</span>
                  <span className="q-pips" aria-label={`${3 - qaLog.length} of 3 questions remaining`}>
                    {[0, 1, 2].map((i) => (
                      <span key={i} className={`q-pip ${i < qaLog.length ? 'is-used' : ''}`} />
                    ))}
                  </span>
                </div>

                {qaLog.length < 3 && state.dealStatus === 'open' && (
                  <div className="chip-row">
                    {STARTER_QUESTIONS.map((chip) => {
                      const alreadyAsked = qaLog.some((item) => item.q.toLowerCase() === chip.toLowerCase());
                      return (
                        <button
                          key={chip}
                          type="button"
                          className="diligence-chip"
                          disabled={alreadyAsked || qaLog.length >= 3}
                          onClick={() => submitQuestion(chip)}
                        >
                          {alreadyAsked ? `✓ ${chip}` : chip}
                        </button>
                      );
                    })}
                  </div>
                )}

                {qaLog.length > 0 && (
                  <div className="qa-log">
                    {qaLog.map((item, idx) => (
                      <div key={idx} className="qa-entry">
                        <div className="qa-q">You: {item.q}</div>
                        <div className="qa-a">Seller: {item.a}</div>
                      </div>
                    ))}
                  </div>
                )}

                {qaLog.length < 3 && state.dealStatus === 'open' && (
                  <form onSubmit={askSeller} className="input-row">
                    <input
                      className="ui-input"
                      value={questionInput}
                      onChange={(e) => setQuestionInput(e.target.value)}
                      onKeyDown={stopInputKeyPropagation}
                      placeholder="Ask a custom diligence question (e.g. staffing, lease, terms)..."
                    />
                    <button type="submit" className="gbtn">
                      Ask
                    </button>
                  </form>
                )}
              </div>

              {/* 1-Shot Sealed Bid */}
              <div className="bid-panel">
                <div className="panel-section-label" style={{ marginBottom: 0 }}>
                  <span>1-Shot Sealed Bid</span>
                  <span className="game-num">Cash: ${state.cash.toFixed(2)}</span>
                </div>

                {state.dealStatus === 'open' ? (
                  <>
                    <div className="input-row">
                      <div className="bid-input-wrap">
                        <span className="bid-dollar-prefix">$</span>
                        <input
                          type="number"
                          min={1}
                          className="ui-input bid-input game-num"
                          value={bidInput}
                          onChange={(e) => setBidInput(e.target.value)}
                          onKeyDown={stopInputKeyPropagation}
                          aria-label="Sealed bid amount"
                        />
                      </div>
                      <button
                        type="button"
                        className="gbtn gbtn-green"
                        style={{ flex: 1 }}
                        onClick={submitSealedBid}
                      >
                        Submit Sealed Bid (${validBid || 0})
                      </button>
                      <button
                        type="button"
                        className="gbtn gbtn-slate"
                        onClick={() => {
                          soundEngine.playClick();
                          setActiveModal(null);
                        }}
                      >
                        Walk Away
                      </button>
                    </div>

                    <div className="bid-preview-strip">
                      <div>
                        <div className="bid-metric-label">Implied 5% Charge</div>
                        <div className="bid-metric-val game-num val-amber">
                          +${impliedBidHurdle.toFixed(2)}/day
                        </div>
                      </div>
                      <div>
                        <div className="bid-metric-label">New Total Hurdle</div>
                        <div className="bid-metric-val game-num">-${newTotalHurdle.toFixed(2)}/day</div>
                      </div>
                      <div>
                        <div className="bid-metric-label">Cash After Bid</div>
                        <div
                          className={`bid-metric-val game-num ${
                            cashAfterBid >= 0 ? 'val-pos' : 'val-neg'
                          }`}
                        >
                          {cashAfterBid >= 0
                            ? `$${cashAfterBid.toFixed(2)}`
                            : `-$${Math.abs(cashAfterBid).toFixed(2)}`}
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}

                {bidMessage && (
                  <div className={`bid-outcome ${state.dealStatus === 'won' ? 'won' : 'rejected'}`}>
                    {bidMessage}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 8:00 PM Closing Bell — End-of-Day Scorecard Modal */}
      {eodRecord && (
        <div className="modal-backdrop">
          <div className="modal-shell is-wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src={icons.sun} alt="" className="px-icon-lg" />
                <div>
                  <div className="modal-kicker">
                    8:00 PM Closing Bell · {neighborhood.name} · Day {eodRecord.day} of {state.maxDays}
                  </div>
                  <div className="modal-title">Day {eodRecord.day} End-of-Day Scorecard</div>
                </div>
              </div>
              <span className={`eod-grade-badge grade-${eodRecord.grade.toLowerCase()} game-num`}>
                Grade {eodRecord.grade}
              </span>
            </div>

            <div className="modal-body">
              {/* Run seed: lets a playtester report this exact run (replay with ?seed=N). */}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
                Run seed {getRunSeed()}
              </div>
              {/* Hero Score & ROIC vs 5% Hurdle */}
              <div className="eod-hero-grid">
                <div className="eod-hero-metric">
                  <div className="eod-hero-label">Today&apos;s Value Created (EVA)</div>
                  <div
                    className={`eod-hero-val game-num ${
                      eodRecord.valueCreated >= 0 ? 'val-pos' : 'val-neg'
                    }`}
                  >
                    {fmtSignedMoney(eodRecord.valueCreated)}
                  </div>
                </div>
                <div className="eod-hero-metric">
                  <div className="eod-hero-label">Daily ROIC vs. 5% Hurdle</div>
                  <div
                    className={`eod-hero-val game-num ${
                      eodRecord.roicPct >= 5 ? 'val-pos' : 'val-amber'
                    }`}
                  >
                    {eodRecord.roicPct.toFixed(1)}%
                  </div>
                </div>
                <div className="eod-hero-metric">
                  <div className="eod-hero-label">Cumulative 30-Day Value</div>
                  <div
                    className={`eod-hero-val game-num ${
                      eodRecord.cumulativeValue >= 0 ? 'val-pos' : 'val-neg'
                    }`}
                  >
                    {fmtSignedMoney(eodRecord.cumulativeValue)}
                  </div>
                </div>
              </div>

              {/* Clean 3-Line Value Bridge */}
              <div className="vendor-card">
                <div className="panel-section-label" style={{ marginBottom: 2 }}>
                  <span>Daily Value Bridge ({eodRecord.cupsSold} Cups Sold)</span>
                  <span className="game-num">Invested Capital: ${investedCap.toFixed(2)}</span>
                </div>
                <div className="impact-list">
                  <div className="impact-line">
                    <span>
                      Revenue (${eodRecord.revenue.toFixed(2)}) − COGS (${eodRecord.cogs.toFixed(2)}) −
                      Rent &amp; Wages (${eodRecord.rentAndWages.toFixed(2)})
                    </span>
                    <span className="game-num">NOPAT {fmtSignedMoney(eodRecord.nopat)}</span>
                  </div>
                  <div className="impact-line">
                    <span>Minus 5% Capital Hurdle Charge</span>
                    <span className="game-num val-amber">-${eodRecord.hurdleCharge.toFixed(2)}</span>
                  </div>
                  <div className="impact-line" style={{ fontWeight: 800, color: 'var(--text-light)' }}>
                    <span>Net Value Created (EVA)</span>
                    <span
                      className={`game-num ${eodRecord.valueCreated >= 0 ? 'val-pos' : 'val-neg'}`}
                    >
                      {fmtSignedMoney(eodRecord.valueCreated)}
                    </span>
                  </div>
                </div>
              </div>

              {/* 30-Day Value Trajectory Strip */}
              <div>
                <div className="panel-section-label">
                  <span>30-Day Value Created Trajectory</span>
                  <span className="game-num">{fmtSignedMoney(eodRecord.cumulativeValue)} Total EVA</span>
                </div>
                {renderValueTrajectoryStrip()}
              </div>

              <button
                type="button"
                className="gbtn gbtn-gold"
                style={{ padding: '10px 18px', fontSize: 14, alignSelf: 'flex-end' }}
                onClick={startNextDay}
              >
                <span>
                  {eodRecord.day >= state.maxDays
                    ? 'Continue Playing →'
                    : `Start Day ${eodRecord.day + 1} (8:00 AM) →`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2.5D Manhattan Island Map Modal */}
      {mapOpen && (
        <ManhattanMapModal
          currentId={neighborhoodId}
          onSelect={handleSelectNeighborhood}
          onClose={() => setMapOpen(false)}
        />
      )}

      {/* Choose Your Founder Character-Select Overlay */}
      {founderModalOpen && (
        <div className="founder-backdrop" onClick={() => setFounderModalOpen(false)}>
          <div className="modal-shell is-founder" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-kicker">The Next Dollar · NYC Lemonade Tycoon</div>
                <div className="modal-title" style={{ fontSize: 20 }}>
                  Choose Your Founder
                </div>
              </div>
              <button
                type="button"
                className="icon-close-btn"
                onClick={() => setFounderModalOpen(false)}
                aria-label="Close Founder Select"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <p className="founder-intro-narration">
                A heatwave has swept Manhattan into a full-blown lemonade craze. Your parents believed in
                you and slipped <strong>$30</strong> into your hand to kickstart your business—lease a
                corner, stock up at Union Square Market, and build a New York empire in 30 days.
              </p>
              <div className="founder-grid">
                {FOUNDER_CATALOG.map((founder) => {
                  const isSelected = founder.id === founderSpecies;
                  return (
                    <button
                      key={founder.id}
                      type="button"
                      className={`founder-card ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => {
                        soundEngine.playClick();
                        setFounderSpecies(founder.id);
                      }}
                    >
                      <div className="founder-figure">
                        <img
                          src={standingSprites[founder.id]}
                          alt={founder.name}
                          className="founder-portrait-img pixel-portrait"
                        />
                        <span className="founder-ground-shadow" aria-hidden="true" />
                      </div>
                      <div className="founder-name">{founder.name}</div>
                      <div className="founder-title-pill">{founder.title}</div>
                      <div className="founder-tagline">{founder.tagline}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="founder-footer">
              <div className="founder-chosen-summary">
                Playing as <strong>{selectedFounder.name}</strong> ({selectedFounder.title}) · Starting in{' '}
                <strong>{neighborhood.name}</strong>
              </div>
              <button
                type="button"
                className="gbtn gbtn-gold"
                style={{ padding: '9px 20px', fontSize: 13.5 }}
                onClick={() => {
                  soundEngine.initOnGesture();
                  if (!soundEngine.isMuted()) {
                    soundEngine.startMusic();
                  }
                  soundEngine.playClick();
                  setFounderModalOpen(false);
                }}
              >
                Open My Stand →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
