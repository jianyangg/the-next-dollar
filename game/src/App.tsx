import { LazyMotion, MotionConfig } from 'motion/react';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { soundEngine } from './audio/soundEngine';
import { connectScene } from './state/connectScene';
import { startGameLoops } from './state/loops';
import { BooksDrawer } from './ui/BooksDrawer';
import { BottomDock } from './ui/BottomDock';
import { EndOfDayModal } from './ui/EndOfDayModal';
import { FounderModal } from './ui/FounderModal';
import { Hud } from './ui/Hud';
import { IntroStory } from './ui/IntroStory';
import { MapModalHost } from './ui/MapModalHost';
import { MarketModals } from './ui/MarketModals';
import { PlotLeaseModal } from './ui/PlotLeaseModal';
import { SellerDealModal } from './ui/SellerDealModal';
import { TravelTransition } from './ui/TravelTransition';
import { TutorialBar } from './ui/TutorialBar';
import { WorldPrompts } from './ui/WorldPrompts';
import { PatienceBars, SalePopLayer, ToastLayer } from './ui/WorldOverlays';

// Dynamic import: the animation features arrive as a separate chunk right after first paint.
// `strict` makes a stray `motion.*` component throw instead of silently pulling the full
// engine back into the bundle; the UI must use the lightweight `m.*` components.
const loadMotionFeatures = () => import('./motionFeatures').then((mod) => mod.default);

// Dev cheat panel: only in development builds (`import.meta.env.DEV` is a compile-time
// constant, so production bundles drop this import entirely) and only with ?dev in the URL.
const DevPanelHost = import.meta.env.DEV
  ? lazy(() => import('./dev/DevPanel').then((mod) => ({ default: mod.DevPanelHost })))
  : null;

/**
 * App is LAYOUT ONLY: a mount point for the 3D scene plus the list of UI pieces.
 *
 *   - Game rules + actions live in `state/gameStore.ts`; per-frame world positions in
 *     `state/anchorStore.ts`. `connectScene` / `startGameLoops` wire the 3D scene and the
 *     timers to those stores.
 *   - Every component under `ui/` subscribes to just the store fields it draws. App itself
 *     subscribes to NOTHING, so it renders once and never again; a change in game state
 *     re-renders only the pieces that show it. In particular the per-frame mini-game
 *     fields (`brewGame`, `serveProgress`) are read only by BrewStep / ServeStep, so the
 *     rest of the UI does not re-render 60 times a second during a mini-game.
 */
export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Create the 3D scene exactly once per mount and wire it to the stores.
  // (StrictMode runs mount -> cleanup -> mount in development; the cleanup disposes the
  // first scene so exactly one stays alive.)
  useEffect(() => {
    if (!mountRef.current) return;
    return connectScene(mountRef.current);
  }, []);

  // Day clock, manager auto-serve and keyboard shortcuts (they read state via the store).
  useEffect(() => startGameLoops(), []);

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

  return (
    // reducedMotion="user": if the OS asks for reduced motion, Motion skips transform/layout
    // animations (opacity fades still play) for the whole UI.
    <MotionConfig reducedMotion="user">
    <LazyMotion features={loadMotionFeatures} strict>
    <div className="game-stage">
      {/* 3D HD-2D Canvas */}
      <div ref={mountRef} className="game-canvas-mount" />

      {/* Top HUD (Chunky Growtopia Game Chrome) */}
      <Hud />

      {/* First-Stall Guided Tutorial Banner (top-center, non-blocking) */}
      <TutorialBar />

      {/* In-World Floating [E] Prompts + Market Sign Pills */}
      <WorldPrompts />

      {/* In-World Customer Queue Patience Bars */}
      <PatienceBars />

      {/* Escalating Sale Pop-Numbers & Perfect Brew Bursts */}
      <SalePopLayer />

      {/* In-World Floating Accounting Toasts */}
      <ToastLayer />

      {/* Bottom Area: Stall Workbench Bar (when INSIDE stand) OR Action Dock */}
      <BottomDock />

      {/* Books Drawer (Financial Statements) */}
      <BooksDrawer />

      {/* Union Square Supply Market vendor modals, plot lease and seller dossier */}
      <MarketModals />
      <PlotLeaseModal />
      <SellerDealModal />

      {/* 8:00 PM Closing Bell — End-of-Day Scorecard Modal */}
      <EndOfDayModal />

      {/* 2.5D Manhattan Island Map Modal */}
      <MapModalHost />

      {/* Choose Your Founder Character-Select Overlay */}
      <FounderModal />

      {/* Opening story (first visit / Replay intro), above the founder picker */}
      <IntroStory />

      {/* Subway ride between districts: doors close, district swaps, doors open */}
      <TravelTransition />

      {DevPanelHost && (
        <Suspense fallback={null}>
          <DevPanelHost />
        </Suspense>
      )}
    </div>
    </LazyMotion>
    </MotionConfig>
  );
}
