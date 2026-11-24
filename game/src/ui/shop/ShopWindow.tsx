import { type ReactNode, useState } from 'react';
import * as m from 'motion/react-m';
import { getNeighborhood } from '../../core/neighborhoods';
import { useGameStore } from '../../state/gameStore';
import { backdropMotion, modalShellMotion } from '../motionPresets';
import { CursorMenu, type CursorMenuItem } from '../kit/CursorMenu';
import { Key, MoneyChipStrip } from '../kit/Money';
import type { PurchasePreview } from './preview';
import '../styles/shop.css';

/**
 * The shared "window over the scene" for every shop and the plot lease:
 *
 *   SIGN window (game controls)
 *     title + a few engine numbers (what you hold)
 *     CURSOR MENU: one row per thing for sale, price on the right, plus "Leave"
 *     PAPER preview: what would move if you bought the row under the cursor
 *
 * Controls live on the sign, money lives on the paper: the two never mix.
 */

export interface ShopRow extends CursorMenuItem {
  /** Paper shown under the menu while the cursor is on this row. */
  preview?: ReactNode;
}

/** One labelled engine number on paper, e.g. [CASH $12]. */
export function PaperChip({ label, value, tone }: { label: string; value: string; tone?: 'gain' | 'cost' }) {
  return (
    <span className="pt-chip" aria-label={`${label} ${value}`}>
      <span className="pt-chip-label">{label}</span>
      <span className={`pt-chip-value ${tone === 'gain' ? 'pt-gain-paper' : tone === 'cost' ? 'pt-cost-paper' : ''}`}>
        {value}
      </span>
    </span>
  );
}

/** Renders a PurchasePreview: money chips, or "Need $X" when the rule refuses for lack of money. */
export function PurchasePreviewView({ preview, children }: { preview: PurchasePreview; children?: ReactNode }) {
  return (
    <div className="shop-preview-row">
      {preview.kind === 'chips' && <MoneyChipStrip chips={preview.chips} />}
      {preview.kind === 'need' && (
        <span className="shop-need pt-disp">
          Need {preview.needs === 'kit' && 'a kit '}
          <span className="pt-num pt-cost-paper">${preview.cost}</span>
        </span>
      )}
      {children}
    </div>
  );
}

/**
 * The two ways out every shop offers. Both existed before the restyle:
 *   "Back to <district>" travels to the last business district (X button + Back button),
 *   "Leave" just closes the window (the old X button / clicking outside).
 */
export function useExitRows(): CursorMenuItem[] {
  const actions = useGameStore((s) => s.actions);
  const lastBusinessNeighborhood = useGameStore((s) => s.lastBusinessNeighborhood);
  const district = getNeighborhood(lastBusinessNeighborhood);
  return [
    { id: 'back', label: `Back to ${district.shortName}`, onSelect: () => actions.selectNeighborhood(lastBusinessNeighborhood) },
    { id: 'leave', label: 'Leave', onSelect: actions.closeModal },
  ];
}

interface ShopWindowProps {
  title: string;
  /** Accessible name of the menu. */
  menuLabel: string;
  portrait?: { src: string; alt: string };
  /** What you hold / what applies, as paper chips next to the title. */
  stats: { label: string; value: string }[];
  rows: ShopRow[];
  onClose: () => void;
}

export function ShopWindow({ title, menuLabel, portrait, stats, rows, onClose }: ShopWindowProps) {
  const [cursorId, setCursorId] = useState<string | undefined>(undefined);
  const items: CursorMenuItem[] = rows.map(({ preview: _preview, ...item }) => item);
  const preview = (rows.find((r) => r.id === cursorId) ?? rows[0])?.preview;

  return (
    <m.div className="pt-scrim" onClick={onClose} {...backdropMotion}>
      <m.div
        className="pt-sign shop-window"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        {...modalShellMotion}
      >
        <header className="pt-titlebar shop-head">
          {portrait && <img src={portrait.src} alt={portrait.alt} className="shop-portrait" />}
          <h2 className="pt-disp shop-title">{title}</h2>
          <div className="shop-stats">
            {stats.map((s) => (
              <PaperChip key={s.label} label={s.label} value={s.value} />
            ))}
          </div>
        </header>

        {/* blocking: nothing behind the window (WASD walking, B, M) reacts while it is open. */}
        <CursorMenu items={items} label={menuLabel} blocking className="shop-menu" onCursorChange={setCursorId} />

        {/* The slot keeps its height so the window does not jump as the cursor moves. */}
        <div className="shop-preview-slot">
          {preview != null && (
            <div className="pt-paper shop-preview" aria-live="polite">
              {preview}
            </div>
          )}
        </div>

        <footer className="shop-keys">
          <span className="shop-key">
            <Key k="E" /> Pick
          </span>
          <span className="shop-key">
            <Key k="Esc" nav /> Leave
          </span>
        </footer>
      </m.div>
    </m.div>
  );
}
