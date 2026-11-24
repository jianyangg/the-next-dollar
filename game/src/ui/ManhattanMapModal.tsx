import React, { useEffect, useMemo, useState } from 'react';
import { soundEngine } from '../audio/soundEngine';
import {
  NEIGHBORHOODS,
  getNeighborhood,
  type NeighborhoodConfig,
  type NeighborhoodId,
} from '../core/neighborhoods';
import { useGameStore } from '../state/gameStore';
import { INPUT_PRIORITY } from '../state/input';
import { createDistrictPedestrianTexture, createMascotPortraitDataUrl } from '../world/pixelArt';
import { getIcons } from './assets';
import { useInputLayer } from './kit/useInputLayer';
import { Key } from './kit/Money';
import { PaperChip } from './shop/ShopWindow';
import { crowdFrames, crowdKinds } from './map/crowdSprites';
import { routeBetween, SUBWAY_LINE_ORDER, toPolylinePoints } from './map/mapRoute';
import { rentPips } from './map/rentTiers';
import './styles/map.css';

export interface ManhattanMapModalProps {
  currentId: NeighborhoodId;
  /**
   * The district the player came from, for the Back button (null = no ride yet). Like a
   * browser's Back: one press rides straight back there, no need to find it on the line.
   */
  backId?: NeighborhoodId | null;
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

/** Every real daily rent, so a plate's coin pips are ranked against the other districts. */
const ALL_RENTS = NEIGHBORHOODS.map((n) => n.dailyRent);

/** River wave marks: [x, y] in map units, placed in the water between the island and the shores. */
const WAVES: ReadonlyArray<readonly [number, number]> = [
  [150, 100], [130, 200], [106, 330], [92, 430], [210, 540],
  [309, 90], [310, 180], [295, 280], [270, 400],
];

/** Tree dots inside Central Park (coordinates in the park's own rotated frame). */
const TREES: ReadonlyArray<readonly [number, number]> = [
  [208, 150], [226, 154], [212, 196], [228, 190], [208, 232], [226, 226], [220, 148], [206, 206], [230, 214], [214, 240],
];

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
/** Q (or Backspace) rides back to the district you came from. */
const BACK_KEYS = ['q', 'Q', 'Backspace'];

/** Map position (percent of the canvas) to SVG user units (the 420x560 viewBox). */
const toX = (pct: number) => (pct / 100) * 420;
const toY = (pct: number) => (pct / 100) * 560;
/** A station's position in SVG units. */
const pointOf = (id: NeighborhoodId) => {
  const n = getNeighborhood(id);
  return { x: toX(n.mapPos.x), y: toY(n.mapPos.y) };
};

/** A little price tag (a "for sale" sign) drawn in SVG; colours come from map.css. */
const PriceTag: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
    <path className="nycmap-pricetag-body" d="M 1 2 L 9 2 L 15 8 L 9 14 L 1 8 Z" />
    <circle className="nycmap-pricetag-hole" cx="5" cy="5" r="1.6" />
  </svg>
);

export const ManhattanMapModal: React.FC<ManhattanMapModalProps> = ({
  currentId,
  backId = null,
  onSelect,
  onClose,
}) => {
  // Back is offered only when it goes somewhere else (never "back" to where you stand).
  const backTo = backId !== null && backId !== currentId ? getNeighborhood(backId) : null;
  const [selectedId, setSelectedId] = useState<NeighborhoodId>(currentId);
  const [hoveredId, setHoveredId] = useState<NeighborhoodId | null>(null);
  const icons = getIcons();
  const founderSpecies = useGameStore((st) => st.founderSpecies);
  // The player's own face on the "you are here" pin (createMascotPortraitDataUrl caches).
  const portrait = useMemo(() => createMascotPortraitDataUrl(founderSpecies), [founderSpecies]);

  useEffect(() => {
    setSelectedId(currentId);
  }, [currentId]);

  // The district on show: the one under the mouse, else the keyboard/clicked one.
  const activeId = hoveredId ?? selectedId;
  const inspected: NeighborhoodConfig = getNeighborhood(activeId);
  const currentConfig: NeighborhoodConfig = getNeighborhood(currentId);
  const isCurrent = inspected.id === currentId;
  const isMarket = inspected.id === 'market';

  // The whole line, and the part of it the train would ride from here to the district on show.
  const linePoints = toPolylinePoints(SUBWAY_LINE_ORDER, pointOf);
  const routePoints = toPolylinePoints(routeBetween(currentId, activeId), pointOf);
  const trainAt = pointOf(activeId);
  const hereAt = currentConfig.mapPos;

  /** Each station has its own note: uptown high, downtown low, so the line sounds like a scale. */
  const chimeFor = (id: NeighborhoodId): void =>
    soundEngine.playMapStation(SUBWAY_LINE_ORDER.indexOf(id), SUBWAY_LINE_ORDER.length);

  const handleTravel = (targetId: NeighborhoodId) => {
    if (targetId !== currentId) {
      soundEngine.playMapSelect(); // "ding-dong": a ride was booked (the depart chime follows)
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
        const nextId = SUBWAY_LINE_ORDER[(at + step + n) % n];
        chimeFor(nextId);
        setHoveredId(null); // the keyboard takes over from a resting mouse
        setSelectedId(nextId);
        return true;
      }
      if (TRAVEL_KEYS.includes(e.key)) {
        e.preventDefault();
        handleTravel(activeId);
        return true;
      }
      if (backTo && BACK_KEYS.includes(e.key)) {
        e.preventDefault();
        handleTravel(backTo.id);
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
            {backTo && (
              <button type="button" className="nycmap-key nycmap-close" onClick={() => handleTravel(backTo.id)}>
                <Key k="Q" nav /> Back to {backTo.shortName}
              </button>
            )}
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

                {/* River wave marks: little zig-zags that shuffle sideways in two steps */}
                {WAVES.map(([x, y]) => (
                  <path
                    key={`wave-${x}-${y}`}
                    className="nycmap-wave"
                    d={`M ${x} ${y} l 4 -3 l 4 3 l 4 -3 l 4 3`}
                  />
                ))}

                <path className="nycmap-island" d={MANHATTAN_PATH} />

                {/* Each district's patch, lightly tinted with its own theme colour. The colour
                    comes from the data (neighborhoods.ts), so it is passed as an inline fill;
                    the CSS class only sets how faint it is. */}
                <g clipPath="url(#nycManhattanClip)">
                  {NEIGHBORHOODS.map((n) => (
                    <circle
                      key={`tint-${n.id}`}
                      className="nycmap-tint"
                      cx={toX(n.mapPos.x)}
                      cy={toY(n.mapPos.y)}
                      r={36}
                      style={{ fill: n.theme.accentHex }}
                    />
                  ))}
                </g>

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
                    {TREES.map(([x, y]) => (
                      <circle key={`tree-${x}-${y}`} className="nycmap-tree" cx={x} cy={y} r={3.5} />
                    ))}
                  </g>
                </g>

                {/* The subway line: a solid blue track with a light core. Blue is the "act"
                    colour; yellow is reserved for the 5% charge. */}
                <polyline className="nycmap-subway" points={linePoints} />
                <polyline className="nycmap-subway-core" points={linePoints} />

                {/* Route: only the stretch of track between where you stand and the district on show */}
                {!isCurrent && <polyline className="nycmap-route" points={routePoints} />}
              </svg>

              {/* The train sits above the station dots and slides (in steps) to the district on show. */}
              <svg className="nycmap-overlay" viewBox="0 0 420 560" aria-hidden="true">
                <g className="nycmap-train" style={{ transform: `translate(${trainAt.x}px, ${trainAt.y}px)` }}>
                  <rect className="nycmap-train-body" x={-14} y={-8} width={28} height={16} />
                  <rect className="nycmap-train-window" x={-10} y={-4} width={6} height={6} />
                  <rect className="nycmap-train-window" x={4} y={-4} width={6} height={6} />
                </g>
              </svg>

              {/* You: the founder's own face, hopping in place above your station */}
              <div
                className="nycmap-pin"
                style={{ left: `${hereAt.x}%`, top: `${hereAt.y}%` }}
                role="img"
                aria-label={`You, at ${currentConfig.name}`}
              >
                <img src={portrait} alt="" className="nycmap-pin-face" />
              </div>

              {/* One station (dot + name plate) per district */}
              {NEIGHBORHOODS.map((n) => {
                const isActive = n.id === activeId;
                const isHere = n.id === currentId;
                const pips = rentPips(n.dailyRent, ALL_RENTS);
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
                    }${n.dailyRent > 0 ? `rent $${n.dailyRent} per day` : 'no rent'}`}
                    onMouseEnter={() => {
                      chimeFor(n.id);
                      setHoveredId(n.id);
                    }}
                    onMouseLeave={() => setHoveredId(null)}
                    onFocus={() => setSelectedId(n.id)}
                    onClick={() => setSelectedId(n.id)}
                    onDoubleClick={() => handleTravel(n.id)}
                  >
                    <span className="nycmap-dot" aria-hidden="true" />
                    <span className="nycmap-plate pt-disp">
                      {n.shortName}
                      {pips > 0 && (
                        <span className="nycmap-pips" aria-hidden="true">
                          {Array.from({ length: pips }).map((_, i) => (
                            <img key={i} src={icons.coin} alt="" className="nycmap-pip" />
                          ))}
                        </span>
                      )}
                      {n.hasSellerDeal && <PriceTag className="nycmap-pricetag" />}
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
              {inspected.hasSellerDeal && (
                <span className="nycmap-tag is-sale">
                  <PriceTag className="nycmap-pricetag" /> For sale
                </span>
              )}
            </div>

            {/* Crowd: the real pedestrians of this district (two walk frames each, swapped in
                steps). The full crowd label is real text for screen readers. */}
            <div className="nycmap-crowd" title={inspected.crowdLabel}>
              <span className="nycmap-sr">{inspected.crowdLabel}</span>
              {crowdKinds(inspected.id).map((kind) => {
                const frames = crowdFrames(kind, (k, phase) => createDistrictPedestrianTexture(k, phase, 'down'));
                if (!frames) return null;
                return (
                  <span key={kind} className="nycmap-ped" aria-hidden="true">
                    <img src={frames[0]} alt="" className="nycmap-ped-frame is-a" />
                    <img src={frames[1]} alt="" className="nycmap-ped-frame is-b" />
                  </span>
                );
              })}
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
