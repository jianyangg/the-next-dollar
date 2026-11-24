import { type StirKey, sweetSpots } from '../core/brewing';
import type { BrewGameState } from '../core/minigames';
import { useGameStore } from '../state/gameStore';
import { getIcons } from './assets';

/**
 * Step 1 of the stall workbench: the four rotating arcade brew challenges.
 *
 * PERFORMANCE NOTE: `brewGame` is replaced ~60 times a second while a challenge runs
 * (the needle, the lemon drop and the fuse all move every frame), so this is one of
 * only two components that subscribe to it (the other is ServeStep, for the pour bar).
 * Keeping that subscription down here means the HUD, books drawer and the rest of the
 * workbench never re-render during a mini-game.
 */

/** The moving gauge for whichever challenge is running. */
function BrewGauge({ game }: { game: BrewGameState }) {
  const pitchers = useGameStore((s) => s.economy.pitchers);
  const workers = useGameStore((s) => s.economy.workers);
  const stirShake = useGameStore((s) => s.stirShake);
  // Sweet-spot widths widen with pitchers and hired workers (core/brewing.ts)
  const { perfectHalf, goodHalf, tubeWidth } = sweetSpots({ pitchers, workers });

  switch (game.kind) {
    case 'triple-squeeze': {
      const tHalf = Math.min(0.11, 0.068 + Math.max(0, pitchers - 1) * 0.012 + workers * 0.015);
      return (
        <div className="wb-skill-gauge" aria-label="Triple Squeeze timing gauge">
          {game.targets.map((tCenter, idx) => {
            const isCurrent = idx === game.step;
            const isDone = idx < game.step;
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
          <div className="wb-skill-needle" style={{ left: `${game.needle * 100}%` }} />
        </div>
      );
    }
    case 'keep-in-tube':
      return (
        <div className="wb-skill-gauge" aria-label="Keep in Tube pressure gauge">
          <div
            className="wb-skill-perfect"
            style={{
              left: `${game.center * 100}%`,
              width: `${tubeWidth * 100}%`,
            }}
          />
          <div className="wb-tube-drop" style={{ left: `${game.drop * 100}%` }} title="Lemon Drop" />
        </div>
      );
    case 'rapid-stir':
      return (
        <div className={`wb-stir-wrap ${stirShake ? 'is-shake' : ''}`}>
          <div className="wb-stir-keys game-num">
            {game.seq.map((k: StirKey, idx: number) => (
              <span
                key={idx}
                className={`wb-stir-key ${
                  idx < game.index ? 'is-done' : idx === game.index ? 'is-active' : ''
                }`}
              >
                {k === 'SPACE' ? '␣' : k}
              </span>
            ))}
          </div>
          <div className="wb-timer-track">
            <div className="wb-timer-fill is-brew" style={{ width: `${Math.round(game.fuse * 100)}%` }} />
          </div>
        </div>
      );
    default:
      return (
        <div className="wb-skill-gauge" aria-label="Counter-Moving Bullseye gauge">
          <div
            className="wb-skill-good"
            style={{
              left: `${game.bullseye * 100}%`,
              width: `${goodHalf * 200}%`,
            }}
          />
          <div
            className="wb-skill-perfect"
            style={{
              left: `${game.bullseye * 100}%`,
              width: `${perfectHalf * 200}%`,
            }}
          />
          <div className="wb-skill-needle" style={{ left: `${game.needle * 100}%` }} />
        </div>
      );
  }
}

/** Header badge text: the challenge name plus its live progress. */
function brewBadge(game: BrewGameState | null): string {
  if (!game) return 'Step 1 · Brew';
  switch (game.kind) {
    case 'triple-squeeze':
      return `TRIPLE SQUEEZE (${game.hits}/3)`;
    case 'keep-in-tube':
      return `KEEP IN TUBE! ${Math.round(game.fill * 100)}%`;
    case 'rapid-stir':
      return `RAPID STIR! (${game.index}/5)`;
    default:
      return 'MOVING BULLSEYE!';
  }
}

/** Label on the big gold action button while a challenge is running. */
function brewButtonLabel(game: BrewGameState): string {
  switch (game.kind) {
    case 'keep-in-tube':
      return 'HOLD / TAP THRUST!';
    case 'rapid-stir':
      return `STIR [${game.seq[game.index] ?? 'SPACE'}]`;
    case 'triple-squeeze':
      return `SQUEEZE (${game.step + 1}/3)!`;
    default:
      return 'SQUEEZE!';
  }
}

export function BrewStep() {
  const actions = useGameStore((s) => s.actions);
  const brewGame = useGameStore((s) => s.brewGame); // per-frame during a challenge
  const brewedCups = useGameStore((s) => s.brewedCups);
  const cupsInStock = useGameStore((s) => s.economy.cupsInStock);
  const pitchers = useGameStore((s) => s.economy.pitchers);
  const icons = getIcons();

  const brewPct = cupsInStock > 0 ? Math.min(100, Math.round((brewedCups / cupsInStock) * 100)) : 0;

  return (
    <div className="workbench-step" style={{ minWidth: 232 }}>
      <div className="wb-step-head">
        <span className="wb-step-badge">{brewBadge(brewGame)}</span>
        <span className="wb-step-meta game-num">
          {brewedCups}/{cupsInStock} ready
        </span>
      </div>

      {brewGame ? (
        <BrewGauge game={brewGame} />
      ) : (
        <div className="wb-brew-track">
          <div className="wb-brew-fill" style={{ width: `${brewPct}%` }} />
        </div>
      )}

      {brewGame ? (
        <button
          type="button"
          className="gbtn gbtn-gold"
          onPointerDown={() => {
            if (brewGame.kind === 'keep-in-tube') {
              actions.setSpaceHeld(true);
            }
          }}
          onPointerUp={() => actions.setSpaceHeld(false)}
          onPointerLeave={() => actions.setSpaceHeld(false)}
          onClick={actions.lockBrewGame}
          style={{ padding: '6px 10px', fontSize: 12 }}
        >
          <span>{brewButtonLabel(brewGame)}</span>
          <span className="keycap">
            {brewGame.kind === 'rapid-stir' ? brewGame.seq[brewGame.index] ?? 'Space' : 'Space'}
          </span>
        </button>
      ) : (
        <button
          type="button"
          className="gbtn gbtn-gold"
          onClick={actions.startBrewGame}
          disabled={cupsInStock <= 0 || brewedCups >= cupsInStock}
          style={{ padding: '6px 10px', fontSize: 12 }}
        >
          <img src={icons.lemon} alt="" className="px-icon-sm" />
          <span>{pitchers < 1 ? 'Need Pitcher!' : cupsInStock <= 0 ? 'Out of Lemons!' : 'Brew Pitcher'}</span>
          <span className="keycap">F</span>
        </button>
      )}
    </div>
  );
}
