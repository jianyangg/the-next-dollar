import React, { useEffect, useState } from 'react';
import { soundEngine } from '../audio/soundEngine';
import {
  NEIGHBORHOODS,
  getNeighborhood,
  type NeighborhoodConfig,
  type NeighborhoodId,
} from '../core/neighborhoods';
import { INPUT_PRIORITY } from '../state/input';
import type { UiIconKind } from '../world/pixelArt';
import { getIcons } from './assets';
import { useInputLayer } from './kit/useInputLayer';
import { Key } from './kit/Money';
import { PaperChip } from './shop/ShopWindow';
import './styles/map.css';

export interface ManhattanMapModalProps {
  currentId: NeighborhoodId;
  onSelect: (id: NeighborhoodId) => void;
  onClose: () => void;
}

/** Which side of its station dot the name plate sits on, so plates never cover neighbours. */
const PIN_SIDE: Record<NeighborhoodId, 'left' | 'right'> = {
  columbia: 'left',
  'central-park': 'left',
  'fifth-ave': 'right',
  broadway: 'left',
  market: 'right',
  'west-village': 'right',
  fidi: 'right',
};

/** North to south: the order the subway line runs, and the order arrow keys walk. */
const SUBWAY_LINE_ORDER: NeighborhoodId[] = [
  'columbia',
  'central-park',
  'fifth-ave',
  'broadway',
  'market',
  'west-village',
  'fidi',
];

/**
 * The crowd of each district as pictures instead of a sentence. There is no dedicated
 * "crowd" art yet, so these reuse the existing pixel icons (book = students, sun = park
 * walkers, coin = shoppers, hurdle = people in a rush, lemon = regulars, ...). The
 * district's full crowd label stays as the icons' tooltip / screen-reader name.
 */
const CROWD_ICONS: Record<NeighborhoodId, UiIconKind[]> = {
  columbia: ['book', 'lemon'],
  'central-park': ['sun', 'lemon'],
  'fifth-ave': ['coin', 'map'],
  broadway: ['hurdle', 'coin'],
  market: ['lemon', 'pitcher'],
  'west-village': ['lemon', 'coin'],
  fidi: ['hurdle', 'book'],
};

// Manhattan Island silhouette in 420x560 viewBox
const MANHATTAN_PATH =
  'M 258 22 ' +
  'L 238 58 L 222 102 L 204 152 L 188 202 L 172 254 L 156 306 L 140 360 L 130 410 ' +
  'L 130 456 L 138 494 L 154 518 ' +
  'L 178 512 L 198 488 L 222 454 L 225 410 L 232 362 L 244 310 L 258 258 L 270 202 ' +
  'L 283 146 L 286 96 L 276 50 L 272 32 Z';

// Keys that move the station cursor (north = previous, south = next) and that travel.
const PREV_KEYS = ['ArrowUp', 'ArrowLeft', 'w', 'W', 'a', 'A'];
const NEXT_KEYS = ['ArrowDown', 'ArrowRight', 's', 'S', 'd', 'D'];
const TRAVEL_KEYS = ['Enter', 'e', 'E'];

/** Map position (percent of the canvas) to SVG user units (the 420x560 viewBox). */
const toX = (pct: number) => (pct / 100) * 420;
const toY = (pct: number) => (pct / 100) * 560;

export const ManhattanMapModal: React.FC<ManhattanMapModalProps> = ({
  currentId,
  onSelect,
  onClose,
}) => {
  const [selectedId, setSelectedId] = useState<NeighborhoodId>(currentId);
  const [hoveredId, setHoveredId] = useState<NeighborhoodId | null>(null);
  const icons = getIcons();

  useEffect(() => {
    setSelectedId(currentId);
  }, [currentId]);

  // The district on show: the one under the mouse, else the keyboard/clicked one.
  const activeId = hoveredId ?? selectedId;
  const inspected: NeighborhoodConfig = getNeighborhood(activeId);
  const currentConfig: NeighborhoodConfig = getNeighborhood(currentId);
  const isCurrent = inspected.id === currentId;
  const isMarket = inspected.id === 'market';

  const subwayPolylinePoints = SUBWAY_LINE_ORDER.map((id) => {
    const n = getNeighborhood(id);
    return `${toX(n.mapPos.x)},${toY(n.mapPos.y)}`;
  }).join(' ');

  const handleTravel = (targetId: NeighborhoodId) => {
    if (targetId !== currentId) {
      onSelect(targetId);
    }
    onClose();
  };

  // Keyboard: arrows/WASD walk the stations, E/Enter travels. This goes through the input
  // router (blocking, like every window) so the player does not walk behind the map.
  // Escape is NOT handled here: the router passes it to the store's handleEscape, which
  // closes the map (founder > map > modal > stand > books).
  useInputLayer(
    (e) => {
      const step = PREV_KEYS.includes(e.key) ? -1 : NEXT_KEYS.includes(e.key) ? 1 : 0;
      if (step !== 0) {
        e.preventDefault();
        const at = SUBWAY_LINE_ORDER.indexOf(activeId);
        const n = SUBWAY_LINE_ORDER.length;
        soundEngine.playClick();
        setHoveredId(null); // the keyboard takes over from a resting mouse
        setSelectedId(SUBWAY_LINE_ORDER[(at + step + n) % n]);
        return true;
      }
      if (TRAVEL_KEYS.includes(e.key)) {
        e.preventDefault();
        handleTravel(activeId);
        return true;
      }
      return false;
    },
    { blocking: true, priority: INPUT_PRIORITY.modal }
  );

  return (
    <div
      className="pt-scrim nycmap-scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Manhattan District Map"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="pt-sign nycmap-window">
        <header className="pt-titlebar nycmap-head">
          <h2 className="pt-disp nycmap-title">
            <img src={icons.map} alt="" className="nycmap-icon" />
            Subway
          </h2>
          <div className="nycmap-keys">
            <span className="nycmap-key">
              <Key k="↑↓" nav /> Pick
            </span>
            <span className="nycmap-key">
              <Key k="E" /> Go
            </span>
            <button type="button" className="nycmap-key nycmap-close" onClick={onClose}>
              <Key k="Esc" nav /> Close
            </button>
          </div>
        </header>

        <div className="nycmap-body">
          <div className="nycmap-stage">
            <div className="nycmap-canvas">
              <svg
                className="nycmap-svg"
                viewBox="0 0 420 560"
                role="img"
                aria-label="Stylized map of Manhattan Island"
              >
                <defs>
                  <clipPath id="nycManhattanClip">
                    <path d={MANHATTAN_PATH} />
                  </clipPath>
                </defs>

                {/* Neighbouring shores (New Jersey, Brooklyn/Queens) */}
                <path className="nycmap-shore" d="M -10 10 L 92 20 L 76 150 L 66 290 L 58 430 L 42 560 L -10 560 Z" />
                <path className="nycmap-shore" d="M 332 10 L 430 10 L 430 560 L 260 560 L 296 470 L 318 350 L 336 210 Z" />

                {/* Hard offset shadow under the island, like every other panel in the game */}
                <g transform="translate(6, 9)">
                  <path className="nycmap-island-shadow" d={MANHATTAN_PATH} />
                </g>

                <path className="nycmap-island" d={MANHATTAN_PATH} />

                {/* Avenue and cross-street grid, clipped to the island */}
                <g clipPath="url(#nycManhattanClip)">
                  <g className="nycmap-grid" transform="rotate(14 210 280)">
                    {Array.from({ length: 12 }).map((_, i) => {
                      const x = 132 + i * 14;
                      return <line key={`ave-${i}`} x1={x} y1={-10} x2={x} y2={580} />;
                    })}
                    {Array.from({ length: 28 }).map((_, i) => {
                      const y = 16 + i * 19;
                      return <line key={`st-${i}`} x1={90} y1={y} x2={340} y2={y} />;
                    })}
                  </g>

                  {/* Broadway, the diagonal street */}
                  <path
                    className="nycmap-broadway"
                    d="M 252 44 L 236 100 L 208 176 L 181 296 L 166 420 L 164 510"
                  />

                  {/* Central Park */}
                  <g transform="rotate(14 218 192)">
                    <rect className="nycmap-park" x="202" y="142" width="32" height="98" />
                    <ellipse className="nycmap-pond" cx="218" cy="176" rx="8" ry="12" />
                    <ellipse className="nycmap-pond" cx="216" cy="216" rx="7" ry="6" />
                  </g>
                </g>

                {/* The subway line joining every station. Not yellow: yellow means the 5% line. */}
                <polyline className="nycmap-subway" points={subwayPolylinePoints} />

                {/* Route from where you stand to the district on show */}
                {!isCurrent && (
                  <line
                    className="nycmap-route"
                    x1={toX(currentConfig.mapPos.x)}
                    y1={toY(currentConfig.mapPos.y)}
                    x2={toX(inspected.mapPos.x)}
                    y2={toY(inspected.mapPos.y)}
                  />
                )}
              </svg>

              {/* One station (dot + name plate) per district */}
              {NEIGHBORHOODS.map((n) => {
                const isActive = n.id === activeId;
                const isHere = n.id === currentId;
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`nycmap-station side-${PIN_SIDE[n.id]}${isActive ? ' is-active' : ''}${
                      isHere ? ' is-here' : ''
                    }`}
                    style={{ left: `${n.mapPos.x}%`, top: `${n.mapPos.y}%` }}
                    aria-label={`${n.name}, ${isHere ? 'you are here, ' : ''}${
                      n.hasSellerDeal ? 'for sale, ' : ''
                    }rent $${n.dailyRent} per day`}
                    onMouseEnter={() => setHoveredId(n.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onFocus={() => setSelectedId(n.id)}
                    onClick={() => setSelectedId(n.id)}
                    onDoubleClick={() => handleTravel(n.id)}
                  >
                    <span className="nycmap-dot" aria-hidden="true" />
                    <span className="nycmap-plate pt-disp">
                      {n.shortName}
                      {isHere && <span className="nycmap-mini is-here">You</span>}
                      {n.hasSellerDeal && <span className="nycmap-mini is-sale">Sale</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* PAPER card: the real numbers for the district on show */}
          <aside className="pt-paper nycmap-card" aria-live="polite">
            <div className="nycmap-street">
              {inspected.streetSignA} × {inspected.streetSignB}
            </div>
            <h3 className="pt-disp nycmap-name">{inspected.name}</h3>

            <div className="nycmap-tags">
              {isCurrent && <span className="nycmap-tag is-here">Here</span>}
              {isMarket && <span className="nycmap-tag is-market">Market</span>}
              {inspected.hasSellerDeal && <span className="nycmap-tag is-sale">For sale</span>}
            </div>

            {/* Crowd as pictures; the full label is the tooltip and the screen-reader name */}
            <div className="nycmap-crowd" role="img" aria-label={inspected.crowdLabel} title={inspected.crowdLabel}>
              {CROWD_ICONS[inspected.id].map((kind, i) => (
                <img key={`${kind}-${i}`} src={icons[kind]} alt="" className="nycmap-crowd-icon" />
              ))}
            </div>

            <div className="nycmap-chips">
              <PaperChip label="RENT/DAY" value={`$${inspected.dailyRent}`} />
              <PaperChip label="PRICE" value={inspected.typicalPrice} />
            </div>

            <div className="nycmap-go">
              {isCurrent ? (
                <button type="button" className="pt-btn is-ghost" onClick={onClose}>
                  <Key k="E" /> Stay
                </button>
              ) : (
                <button type="button" className="pt-btn" onClick={() => handleTravel(inspected.id)}>
                  <Key k="E" /> Go
                </button>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default ManhattanMapModal;
