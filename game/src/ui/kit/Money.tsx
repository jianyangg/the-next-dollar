import { animate } from 'motion/react';
import { useEffect, useRef } from 'react';
import type { ChipKind, MoneyChip } from '../../core/ledgerChips';
import { fmtSignedMoney } from '../format';

/**
 * Small shared pieces of the Paper Trail kit (see styles/kit.css for their look).
 */

/** A round "route marker" showing the key to press, e.g. <Key k="E" />. */
export function Key({ k, nav = false }: { k: string; nav?: boolean }) {
  return (
    <span className={`pt-key ${nav ? 'is-nav' : ''}`} aria-hidden="true">
      {k}
    </span>
  );
}

/** Plain-word chip labels. "5%/day" is THE LINE: the daily cost of every dollar in the business. */
export const CHIP_LABEL: Record<ChipKind, string> = {
  cash: 'CASH',
  stock: 'STOCK',
  gear: 'GEAR',
  profit: 'PROFIT',
  line: '5%/DAY',
};

/**
 * "$0" for a zero profit chip (the lesson: buying is not losing), otherwise a signed
 * amount. The 5% line shows its per-day change.
 */
export function chipValue(chip: MoneyChip): string {
  if (chip.delta === 0) return '$0';
  return fmtSignedMoney(chip.delta);
}

/** Which way a chip reads for the player: more cash/profit is good, a higher 5% bar is a cost. */
export function chipTone(chip: MoneyChip): 'gain' | 'cost' | 'flat' {
  if (chip.delta === 0) return 'flat';
  const good = chip.kind === 'line' ? chip.delta < 0 : chip.delta > 0;
  // Stock and gear going up is neither good nor bad: it is cash changing form.
  if (chip.kind === 'stock' || chip.kind === 'gear') return 'flat';
  return good ? 'gain' : 'cost';
}

/** A row of paper chips: [CASH −$10] [GEAR +$10] [PROFIT $0] [5%/DAY +$0.50]. */
export function MoneyChipStrip({ chips }: { chips: MoneyChip[] }) {
  if (chips.length === 0) return null;
  return (
    <span className="pt-chip-strip">
      {chips.map((chip) => {
        const tone = chipTone(chip);
        return (
          <span
            key={chip.kind}
            className={`pt-chip ${chip.kind === 'line' ? 'is-line' : ''}`}
            aria-label={`${CHIP_LABEL[chip.kind]} ${chipValue(chip)}`}
          >
            <span className="pt-chip-label">{CHIP_LABEL[chip.kind]}</span>
            <span
              className={`pt-chip-value ${tone === 'gain' ? 'pt-gain-paper' : tone === 'cost' ? 'pt-cost-paper' : ''}`}
            >
              {chipValue(chip)}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * A number that counts from its previous value to the new one (money arriving).
 * Writes straight to the DOM node each frame (no React re-render per frame), and
 * respects reduced motion through Motion's global MotionConfig.
 */
export function CountUp({
  value,
  format,
  duration = 0.6,
  className,
}: {
  value: number;
  format: (v: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const shown = useRef(value);

  useEffect(() => {
    const from = shown.current;
    if (from === value) return;
    const controls = animate(from, value, {
      duration,
      ease: [0.215, 0.61, 0.355, 1], // ease-out cubic, same as --ease-count
      onUpdate: (v) => {
        shown.current = v;
        if (ref.current) ref.current.textContent = format(v);
      },
    });
    return () => controls.stop();
  }, [value, duration, format]);

  return (
    <span ref={ref} className={className}>
      {format(shown.current)}
    </span>
  );
}
