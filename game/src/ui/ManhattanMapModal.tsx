import React, { useEffect, useMemo, useState } from 'react';
import {
  NEIGHBORHOODS,
  getNeighborhood,
  type NeighborhoodConfig,
  type NeighborhoodId,
} from '../core/neighborhoods';
import { createUiIconDataUrl } from '../world/pixelArt';

export interface ManhattanMapModalProps {
  currentId: NeighborhoodId;
  onSelect: (id: NeighborhoodId) => void;
  onClose: () => void;
}

const PIN_SIDE: Record<NeighborhoodId, 'left' | 'right'> = {
  columbia: 'left',
  'central-park': 'left',
  'fifth-ave': 'right',
  broadway: 'left',
  market: 'right',
  'west-village': 'right',
  fidi: 'right',
};

const SUBWAY_LINE_ORDER: NeighborhoodId[] = [
  'columbia',
  'central-park',
  'fifth-ave',
  'broadway',
  'market',
  'west-village',
  'fidi',
];

function getPriceTolerancePercent(priceSensitivity: number): number {
  const normalized = (1.18 - priceSensitivity) / (1.18 - 0.8);
  return Math.max(18, Math.min(96, Math.round(normalized * 100)));
}

function getRentTierLabel(dailyRent: number): { label: string; color: string } {
  if (dailyRent === 0) return { label: 'Free entry', color: '#86efac' };
  if (dailyRent <= 3) return { label: 'Low overhead', color: '#86efac' };
  if (dailyRent <= 5) return { label: 'Mid-tier rent', color: '#fde047' };
  return { label: 'Prime rent', color: '#fdba74' };
}

// Manhattan Island silhouette in 420x560 viewBox
const MANHATTAN_PATH =
  'M 258 22 ' +
  'L 238 58 L 222 102 L 204 152 L 188 202 L 172 254 L 156 306 L 140 360 L 130 410 ' +
  'L 130 456 L 138 494 L 154 518 ' +
  'L 178 512 L 198 488 L 222 454 L 225 410 L 232 362 L 244 310 L 258 258 L 270 202 ' +
  'L 283 146 L 286 96 L 276 50 L 272 32 Z';

export const ManhattanMapModal: React.FC<ManhattanMapModalProps> = ({
  currentId,
  onSelect,
  onClose,
}) => {
  const [selectedId, setSelectedId] = useState<NeighborhoodId>(currentId);
  const [hoveredId, setHoveredId] = useState<NeighborhoodId | null>(null);

  const icons = useMemo(
    () => ({
      map: createUiIconDataUrl('map'),
      market: createUiIconDataUrl('market'),
      coin: createUiIconDataUrl('coin'),
      lemon: createUiIconDataUrl('lemon'),
    }),
    [],
  );

  useEffect(() => {
    setSelectedId(currentId);
  }, [currentId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  const activeId = hoveredId ?? selectedId;
  const inspected: NeighborhoodConfig = getNeighborhood(activeId);
  const currentConfig: NeighborhoodConfig = getNeighborhood(currentId);
  const isCurrent = inspected.id === currentId;
  const isMarket = inspected.id === 'market';
  const rentTier = getRentTierLabel(inspected.dailyRent);
  const priceTolerance = getPriceTolerancePercent(inspected.priceSensitivity);

  const subwayPolylinePoints = SUBWAY_LINE_ORDER.map((id) => {
    const n = getNeighborhood(id);
    return `${(n.mapPos.x / 100) * 420},${(n.mapPos.y / 100) * 560}`;
  }).join(' ');

  const handleTravel = (targetId: NeighborhoodId) => {
    if (targetId !== currentId) {
      onSelect(targetId);
    }
    onClose();
  };

  return (
    <div
      className="nyc-map-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Manhattan District Map"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <style>{`
        .nyc-map-backdrop {
          position: fixed;
          inset: 0;
          z-index: 40;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          background: rgba(8, 16, 28, 0.7);
          font-family: 'Fredoka', 'Trebuchet MS', 'Segoe UI', sans-serif;
          animation: nycMapFadeIn 150ms cubic-bezier(0.215, 0.61, 0.355, 1);
        }

        @keyframes nycMapFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes nycMapEnter {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }

        @keyframes nycMapRingPulse {
          0% { transform: translate(-50%, -50%) scale(0.92); opacity: 0.9; }
          75% { transform: translate(-50%, -50%) scale(1.85); opacity: 0; }
          100% { transform: translate(-50%, -50%) scale(1.85); opacity: 0; }
        }

        /* Single clean outer modal frame — zero nested borders inside */
        .nyc-map-shell {
          width: min(980px, 100%);
          max-height: min(680px, calc(100vh - 32px));
          display: flex;
          flex-direction: column;
          background: rgba(32, 72, 106, 0.93);
          border: 2px solid rgba(158, 214, 248, 0.72);
          border-radius: 12px;
          box-shadow: 0 4px 12px rgba(4, 10, 20, 0.35), 0 20px 48px rgba(4, 10, 20, 0.55);
          overflow: hidden;
          color: #f4faff;
          animation: nycMapEnter 180ms cubic-bezier(0.23, 1, 0.32, 1);
        }

        /* Header: subtle borderless tonal band */
        .nyc-map-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 14px 20px;
          background: rgba(16, 40, 64, 0.45);
        }

        .nyc-map-title-group {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .nyc-subway-bullets {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }

        .nyc-bullet {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 800;
          color: #ffffff;
        }

        .nyc-map-title {
          font-size: 17px;
          font-weight: 800;
          letter-spacing: -0.01em;
          color: #ffffff;
          line-height: 1.2;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .nyc-px-icon {
          width: 16px;
          height: 16px;
          image-rendering: pixelated;
          display: inline-block;
          flex-shrink: 0;
        }

        .nyc-px-icon-sm {
          width: 14px;
          height: 14px;
          image-rendering: pixelated;
          display: inline-block;
          flex-shrink: 0;
        }

        .nyc-map-subtitle {
          font-size: 12px;
          font-weight: 500;
          color: #b8dcf5;
          margin-top: 2px;
        }

        .nyc-map-header-right {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .nyc-map-legend {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 11.5px;
          font-weight: 600;
          color: #cfe8fa;
        }

        .nyc-legend-item {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
        }

        .nyc-legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .nyc-close-btn {
          appearance: none;
          border: none;
          background: rgba(220, 76, 76, 0.9);
          color: #ffffff;
          font-family: inherit;
          font-size: 12px;
          font-weight: 700;
          height: 32px;
          padding: 0 12px;
          border-radius: 6px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          transition: background 120ms ease, transform 90ms ease;
        }

        .nyc-close-btn:hover {
          background: #ef4444;
        }

        .nyc-close-btn:active {
          transform: scale(0.97);
        }

        .nyc-map-body {
          display: grid;
          grid-template-columns: minmax(340px, 1.12fr) minmax(300px, 0.88fr);
          min-height: 0;
          flex: 1;
          overflow: hidden;
          padding: 16px;
          gap: 20px;
        }

        /* Left Map Stage: borderless tonal water surface */
        .nyc-map-stage {
          position: relative;
          background: rgba(14, 38, 62, 0.56);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 12px;
          overflow: hidden;
        }

        .nyc-map-canvas {
          position: relative;
          width: 100%;
          max-width: 440px;
          aspect-ratio: 420 / 560;
          max-height: 100%;
        }

        .nyc-map-svg {
          width: 100%;
          height: 100%;
          display: block;
          overflow: visible;
        }

        /* Interactive Landmark Pins */
        .nyc-pin-anchor {
          position: absolute;
          transform: translate(-50%, -50%);
          z-index: 4;
        }

        .nyc-pin-anchor.is-active {
          z-index: 9;
        }

        .nyc-pin-ring {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          border: 2px solid #fde047;
          pointer-events: none;
          animation: nycMapRingPulse 2s cubic-bezier(0.2, 0.7, 0.3, 1) infinite;
        }

        .nyc-pin-dot-btn {
          position: relative;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: none;
          background: var(--pin-accent, #f5c84c);
          box-shadow: 0 0 0 2.5px rgba(255, 255, 255, 0.92), 0 2px 6px rgba(4, 10, 20, 0.55);
          cursor: pointer;
          transition: transform 120ms ease;
          display: block;
        }

        .nyc-pin-anchor.is-active .nyc-pin-dot-btn,
        .nyc-pin-dot-btn:hover {
          transform: scale(1.24);
        }

        .nyc-pin-card {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          appearance: none;
          border: none;
          font-family: inherit;
          text-align: left;
          background: rgba(16, 42, 68, 0.9);
          border-radius: 6px;
          padding: 5px 9px;
          color: #f4faff;
          cursor: pointer;
          white-space: nowrap;
          box-shadow: 0 3px 10px rgba(4, 10, 20, 0.42);
          transition: background 120ms ease, transform 100ms ease;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .nyc-pin-card.side-left {
          right: 18px;
        }

        .nyc-pin-card.side-right {
          left: 18px;
        }

        .nyc-pin-card:hover,
        .nyc-pin-anchor.is-active .nyc-pin-card {
          background: rgba(42, 92, 134, 0.98);
        }

        .nyc-pin-anchor.is-market .nyc-pin-card {
          background: rgba(20, 88, 52, 0.94);
        }

        .nyc-pin-anchor.is-market.is-active .nyc-pin-card,
        .nyc-pin-anchor.is-market .nyc-pin-card:hover {
          background: rgba(24, 112, 64, 0.98);
        }

        .nyc-pin-anchor.is-current .nyc-pin-card {
          box-shadow: inset 3px 0 0 #fde047, 0 3px 10px rgba(4, 10, 20, 0.48);
        }

        .nyc-pin-card-top {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .nyc-pin-name {
          font-size: 11.5px;
          font-weight: 700;
          color: #ffffff;
        }

        .nyc-pin-badge {
          font-size: 9.5px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 4px;
          line-height: 1.25;
        }

        .nyc-pin-badge-market {
          background: #22c55e;
          color: #082212;
        }

        .nyc-pin-badge-deal {
          background: #2dd4bf;
          color: #072220;
        }

        .nyc-pin-badge-here {
          background: #fde047;
          color: #1c1917;
        }

        .nyc-pin-meta {
          font-size: 10.5px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          color: #b6dcf7;
        }

        .nyc-pin-meta strong {
          color: #ffffff;
          font-weight: 700;
        }

        /* Right Inspector: borderless whitespace & tonal hierarchy */
        .nyc-inspector {
          padding: 4px 4px 4px 0;
          display: flex;
          flex-direction: column;
          gap: 16px;
          overflow-y: auto;
          color: #f4faff;
        }

        .nyc-street-sign-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
        }

        .nyc-street-sign {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #15803d;
          border-radius: 5px;
          padding: 4px 10px;
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.06em;
          color: #ffffff;
          text-transform: uppercase;
        }

        .nyc-street-sign-sep {
          opacity: 0.65;
        }

        .nyc-status-badges {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .nyc-badge {
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 5px;
        }

        .nyc-badge-current {
          background: #fde047;
          color: #1c1917;
        }

        .nyc-badge-deal {
          background: #2dd4bf;
          color: #072220;
        }

        .nyc-badge-market {
          background: #22c55e;
          color: #082212;
        }

        .nyc-inspector-heading {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .nyc-inspector-name {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.015em;
          color: #ffffff;
          display: flex;
          align-items: center;
          gap: 8px;
          line-height: 1.15;
        }

        .nyc-accent-swatch {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .nyc-inspector-crowd {
          font-size: 13px;
          font-weight: 700;
          color: #fde047;
        }

        .nyc-inspector-desc {
          font-size: 13.5px;
          font-weight: 500;
          line-height: 1.5;
          color: #d6ecfc;
        }

        .nyc-metrics-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 20px;
          padding: 4px 0;
        }

        /* Open unboxed metric columns — separated by space alone */
        .nyc-metric-card {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .nyc-metric-label {
          font-size: 11.5px;
          font-weight: 600;
          color: #9ecceb;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .nyc-metric-value {
          font-size: 22px;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
          color: #ffffff;
        }

        .nyc-metric-sub {
          font-size: 11.5px;
          font-weight: 600;
        }

        .nyc-sensitivity-card {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 2px 0;
        }

        .nyc-sensitivity-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 12px;
          font-weight: 600;
          color: #dff2ff;
        }

        .nyc-tabular {
          font-variant-numeric: tabular-nums;
          font-weight: 700;
        }

        .nyc-bar-track {
          width: 100%;
          height: 8px;
          border-radius: 4px;
          background: rgba(8, 22, 38, 0.65);
          overflow: hidden;
        }

        .nyc-bar-fill {
          height: 100%;
          border-radius: 4px;
          background: linear-gradient(90deg, #4ade80 0%, #facc15 55%, #fb923c 100%);
          transition: width 180ms cubic-bezier(0.22, 1, 0.36, 1);
        }

        .nyc-callout {
          border-radius: 8px;
          padding: 12px;
          font-size: 12.5px;
          font-weight: 500;
          line-height: 1.45;
        }

        .nyc-callout-deal {
          background: rgba(20, 184, 166, 0.16);
          color: #ccfbf1;
        }

        .nyc-callout-market {
          background: rgba(34, 197, 94, 0.16);
          color: #dcfce7;
        }

        .nyc-inspector-spacer {
          flex: 1;
        }

        .nyc-cta-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .nyc-route-hint {
          font-size: 12px;
          font-weight: 600;
          color: #a6d4f2;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .nyc-travel-btn {
          width: 100%;
          height: 44px;
          appearance: none;
          border: none;
          font-family: inherit;
          border-radius: 8px;
          padding: 0 16px;
          font-size: 14.5px;
          font-weight: 800;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: filter 120ms ease, transform 90ms ease;
        }

        .nyc-travel-btn:hover {
          filter: brightness(1.08);
        }

        .nyc-travel-btn:active {
          transform: scale(0.98);
        }

        .nyc-travel-btn.primary {
          background: #eab308;
          color: #102030;
        }

        .nyc-travel-btn.market {
          background: #22c55e;
          color: #ffffff;
        }

        .nyc-travel-btn.current {
          background: #2b7cb3;
          color: #ffffff;
        }

        @media (max-width: 780px) {
          .nyc-map-shell {
            max-height: calc(100vh - 20px);
          }
          .nyc-map-legend {
            display: none;
          }
          .nyc-map-body {
            grid-template-columns: 1fr;
            overflow-y: auto;
          }
          .nyc-map-stage {
            min-height: 360px;
          }
          .nyc-map-canvas {
            max-width: 310px;
          }
          .nyc-inspector {
            padding: 0;
          }
        }
      `}</style>

      <div className="nyc-map-shell">
        {/* Header */}
        <div className="nyc-map-header">
          <div className="nyc-map-title-group">
            <div className="nyc-subway-bullets" aria-hidden="true">
              <span className="nyc-bullet" style={{ background: '#ee352e' }}>
                1
              </span>
              <span className="nyc-bullet" style={{ background: '#2850ad' }}>
                A
              </span>
              <span className="nyc-bullet" style={{ background: '#fccc0a', color: '#151926' }}>
                N
              </span>
            </div>
            <div>
              <div className="nyc-map-title">
                <img src={icons.map} alt="" className="nyc-px-icon" />
                <span>Manhattan Subway Map</span>
              </div>
              <div className="nyc-map-subtitle">
                Pick a street corner to sell, or head to Union Square Supply Market
              </div>
            </div>
          </div>

          <div className="nyc-map-header-right">
            <div className="nyc-map-legend" aria-hidden="true">
              <span className="nyc-legend-item">
                <span className="nyc-legend-dot" style={{ background: '#fde047' }} />
                Here
              </span>
              <span className="nyc-legend-item">
                <span className="nyc-legend-dot" style={{ background: '#22c55e' }} />
                Market
              </span>
              <span className="nyc-legend-item">
                <span className="nyc-legend-dot" style={{ background: '#2dd4bf' }} />
                Deal
              </span>
            </div>
            <button type="button" className="nyc-close-btn" onClick={onClose}>
              <span>Esc</span>
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>

        {/* Body: 2.5D Manhattan Map + Inspector */}
        <div className="nyc-map-body">
          <div className="nyc-map-stage">
            <div className="nyc-map-canvas">
              <svg
                className="nyc-map-svg"
                viewBox="0 0 420 560"
                role="img"
                aria-label="Stylized 2.5D map of Manhattan Island"
              >
                <defs>
                  <linearGradient id="nycLandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#e5d5b3" />
                    <stop offset="55%" stopColor="#d7c299" />
                    <stop offset="100%" stopColor="#c7ae80" />
                  </linearGradient>

                  <linearGradient id="nycParkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#4ade80" />
                    <stop offset="100%" stopColor="#16a34a" />
                  </linearGradient>

                  <clipPath id="nycManhattanClip">
                    <path d={MANHATTAN_PATH} />
                  </clipPath>
                </defs>

                {/* Stylized Neighboring Boroughs */}
                <path
                  d="M -10 10 L 92 20 L 76 150 L 66 290 L 58 430 L 42 560 L -10 560 Z"
                  fill="rgba(22, 62, 96, 0.55)"
                />
                <path
                  d="M 332 10 L 430 10 L 430 560 L 260 560 L 296 470 L 318 350 L 336 210 Z"
                  fill="rgba(22, 62, 96, 0.55)"
                />

                {/* Subtle Water Wave Lines */}
                <g opacity="0.22" stroke="#93d5ff" strokeWidth="1.6" strokeLinecap="round" fill="none">
                  <path d="M 96 72 Q 112 190 92 310 T 86 500" strokeDasharray="7 11" />
                  <path d="M 304 90 Q 288 230 278 360 T 242 520" strokeDasharray="7 11" />
                </g>

                {/* River Labels */}
                <text
                  x="56"
                  y="272"
                  transform="rotate(-77 56 272)"
                  fill="rgba(196, 232, 255, 0.55)"
                  fontSize="11"
                  fontWeight="700"
                  letterSpacing="0.26em"
                  textAnchor="middle"
                >
                  HUDSON RIVER
                </text>
                <text
                  x="336"
                  y="328"
                  transform="rotate(-74 336 328)"
                  fill="rgba(196, 232, 255, 0.55)"
                  fontSize="11"
                  fontWeight="700"
                  letterSpacing="0.26em"
                  textAnchor="middle"
                >
                  EAST RIVER
                </text>

                {/* Compass Rose */}
                <g transform="translate(364, 52)">
                  <circle cx="0" cy="0" r="15" fill="rgba(16, 42, 66, 0.72)" />
                  <polygon points="0,-10 3.5,-2 0,-4 -3.5,-2" fill="#fde047" />
                  <polygon points="0,10 3.5,2 0,4 -3.5,2" fill="#94a3b8" />
                  <text
                    x="0"
                    y="-19"
                    textAnchor="middle"
                    fill="#e0f2fe"
                    fontSize="10"
                    fontWeight="800"
                  >
                    N
                  </text>
                </g>

                {/* Subtle 2.5D Island Shadow & Elevation Edge */}
                <g transform="translate(6, 9)">
                  <path d={MANHATTAN_PATH} fill="rgba(8, 20, 36, 0.42)" />
                </g>
                <g transform="translate(3, 5)">
                  <path d={MANHATTAN_PATH} fill="#8a6d49" />
                </g>

                {/* Main Manhattan Island Landmass */}
                <path
                  d={MANHATTAN_PATH}
                  fill="url(#nycLandGrad)"
                  stroke="rgba(20, 34, 52, 0.75)"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />

                {/* Avenue & Cross-Street Grid Clipped Inside Manhattan */}
                <g clipPath="url(#nycManhattanClip)">
                  <g transform="rotate(14 210 280)" stroke="rgba(120, 88, 52, 0.24)" strokeWidth="1">
                    {Array.from({ length: 12 }).map((_, i) => {
                      const x = 132 + i * 14;
                      return <line key={`ave-${i}`} x1={x} y1={-10} x2={x} y2={580} />;
                    })}
                    {Array.from({ length: 28 }).map((_, i) => {
                      const y = 16 + i * 19;
                      return <line key={`st-${i}`} x1={90} y1={y} x2={340} y2={y} />;
                    })}
                  </g>

                  {/* Broadway Diagonal Spine */}
                  <path
                    d="M 252 44 L 236 100 L 208 176 L 181 296 L 166 420 L 164 510"
                    fill="none"
                    stroke="#b8762c"
                    strokeWidth="2"
                    opacity="0.58"
                  />

                  {/* Central Park Green Rectangle */}
                  <g transform="rotate(14 218 192)">
                    <rect
                      x="202"
                      y="142"
                      width="32"
                      height="98"
                      rx="3"
                      fill="url(#nycParkGrad)"
                    />
                    <ellipse cx="218" cy="176" rx="8" ry="12" fill="#38bdf8" opacity="0.85" />
                    <ellipse cx="216" cy="216" rx="7" ry="6" fill="#38bdf8" opacity="0.8" />
                  </g>
                </g>

                {/* Subway Transit Connector Line */}
                <polyline
                  points={subwayPolylinePoints}
                  fill="none"
                  stroke="rgba(16, 30, 48, 0.45)"
                  strokeWidth="3.5"
                  strokeDasharray="6 6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points={subwayPolylinePoints}
                  fill="none"
                  stroke="#fde047"
                  strokeWidth="2"
                  strokeDasharray="6 6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Highlighted Subway Transfer Line */}
                {!isCurrent && (
                  <line
                    x1={(currentConfig.mapPos.x / 100) * 420}
                    y1={(currentConfig.mapPos.y / 100) * 560}
                    x2={(inspected.mapPos.x / 100) * 420}
                    y2={(inspected.mapPos.y / 100) * 560}
                    stroke={isMarket ? '#4ade80' : '#f87171'}
                    strokeWidth="3"
                    strokeDasharray="7 5"
                    strokeLinecap="round"
                  />
                )}
              </svg>

              {/* 7 Interactive Landmark Pins */}
              {NEIGHBORHOODS.map((n) => {
                const isSelectedOrHovered = n.id === activeId;
                const isCurrentLoc = n.id === currentId;
                const isMarketPin = n.id === 'market';
                const side = PIN_SIDE[n.id];

                return (
                  <div
                    key={n.id}
                    className={`nyc-pin-anchor${isSelectedOrHovered ? ' is-active' : ''}${
                      isCurrentLoc ? ' is-current' : ''
                    }${isMarketPin ? ' is-market' : ''}`}
                    style={
                      {
                        left: `${n.mapPos.x}%`,
                        top: `${n.mapPos.y}%`,
                        '--pin-accent': n.theme.accentHex,
                      } as React.CSSProperties
                    }
                    onMouseEnter={() => setHoveredId(n.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    {isCurrentLoc && <span className="nyc-pin-ring" aria-hidden="true" />}

                    <button
                      type="button"
                      className="nyc-pin-dot-btn"
                      aria-label={`${n.name}, ${
                        isMarketPin
                          ? 'Wholesale Supply Market'
                          : `Rent $${n.dailyRent} per day, Typical price ${n.typicalPrice}`
                      }`}
                      onFocus={() => setSelectedId(n.id)}
                      onClick={() => setSelectedId(n.id)}
                      onDoubleClick={() => handleTravel(n.id)}
                    />

                    <button
                      type="button"
                      className={`nyc-pin-card side-${side}`}
                      onFocus={() => setSelectedId(n.id)}
                      onClick={() => setSelectedId(n.id)}
                      onDoubleClick={() => handleTravel(n.id)}
                    >
                      <span className="nyc-pin-card-top">
                        <span className="nyc-pin-name">{n.shortName}</span>
                        {isCurrentLoc && <span className="nyc-pin-badge nyc-pin-badge-here">Here</span>}
                        {isMarketPin && (
                          <span className="nyc-pin-badge nyc-pin-badge-market">Market</span>
                        )}
                        {n.hasSellerDeal && (
                          <span className="nyc-pin-badge nyc-pin-badge-deal">Deal</span>
                        )}
                      </span>
                      <span className="nyc-pin-meta">
                        {isMarketPin ? (
                          <>
                            <strong>Free</strong> · {n.typicalPrice}
                          </>
                        ) : (
                          <>
                            <strong>${n.dailyRent}/d</strong> · {n.typicalPrice}
                          </>
                        )}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right-Side Inspector: borderless whitespace & tonal hierarchy */}
          <aside className="nyc-inspector" aria-live="polite">
            <div className="nyc-street-sign-bar">
              <div className="nyc-street-sign">
                <span>{inspected.streetSignA}</span>
                <span className="nyc-street-sign-sep">×</span>
                <span>{inspected.streetSignB}</span>
              </div>

              <div className="nyc-status-badges">
                {isCurrent && <span className="nyc-badge nyc-badge-current">Here</span>}
                {isMarket && <span className="nyc-badge nyc-badge-market">Supply Market</span>}
                {inspected.hasSellerDeal && (
                  <span className="nyc-badge nyc-badge-deal">Seller Deal</span>
                )}
              </div>
            </div>

            <div className="nyc-inspector-heading">
              <h2 className="nyc-inspector-name">
                <span
                  className="nyc-accent-swatch"
                  style={{ background: inspected.theme.accentHex }}
                />
                {inspected.name}
              </h2>
              <div className="nyc-inspector-crowd">{inspected.crowdLabel}</div>
            </div>

            <p className="nyc-inspector-desc">{inspected.description}</p>

            <div className="nyc-metrics-grid">
              <div className="nyc-metric-card">
                <span className="nyc-metric-label">
                  <img src={icons.coin} alt="" className="nyc-px-icon-sm" />
                  Daily rent
                </span>
                <span className="nyc-metric-value">${inspected.dailyRent}/day</span>
                <span className="nyc-metric-sub" style={{ color: rentTier.color }}>
                  {rentTier.label}
                </span>
              </div>

              <div className="nyc-metric-card">
                <span className="nyc-metric-label">
                  <img src={isMarket ? icons.market : icons.lemon} alt="" className="nyc-px-icon-sm" />
                  {isMarket ? 'Market stalls' : 'Typical price'}
                </span>
                <span className="nyc-metric-value">{inspected.typicalPrice}</span>
                <span className="nyc-metric-sub" style={{ color: '#9ed2f5' }}>
                  {isMarket ? 'Lemons & pitchers' : 'Crowd sweet spot'}
                </span>
              </div>
            </div>

            {isMarket ? (
              <div
                className="nyc-callout nyc-callout-market"
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}
              >
                <img src={icons.market} alt="" className="nyc-px-icon" style={{ marginTop: 2 }} />
                <div>
                  <strong>Prep your stand:</strong> Visit the Lemon Vendor and Pitcher Vendor stalls
                  at Union Square to restock inventory and gear before serving your neighborhood.
                </div>
              </div>
            ) : (
              <div className="nyc-sensitivity-card">
                <div className="nyc-sensitivity-row">
                  <span className="nyc-metric-label">Pricing power</span>
                  <span className="nyc-tabular">
                    Sensitivity {inspected.priceSensitivity.toFixed(2)}×
                  </span>
                </div>
                <div className="nyc-bar-track">
                  <div className="nyc-bar-fill" style={{ width: `${priceTolerance}%` }} />
                </div>
                <div className="nyc-sensitivity-row" style={{ fontSize: '11px', color: '#93c5e8' }}>
                  <span>Price-conscious</span>
                  <span>Premium-willing</span>
                </div>
              </div>
            )}

            {inspected.hasSellerDeal && (
              <div className="nyc-callout nyc-callout-deal">
                <strong>Acquisition lead:</strong> A local stand owner in {inspected.shortName} is
                taking buyout bids. Subway over to inspect their books.
              </div>
            )}

            <div className="nyc-inspector-spacer" />

            <div className="nyc-cta-group">
              <div className="nyc-route-hint">
                <span>Current stop: {currentConfig.shortName}</span>
                <span>Subway fare: Free</span>
              </div>

              {isCurrent ? (
                <button type="button" className="nyc-travel-btn current" onClick={onClose}>
                  At {inspected.shortName} · Back to street
                </button>
              ) : (
                <button
                  type="button"
                  className={`nyc-travel-btn ${isMarket ? 'market' : 'primary'}`}
                  onClick={() => handleTravel(inspected.id)}
                >
                  Subway to {inspected.name} →
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
