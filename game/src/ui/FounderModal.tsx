import { getNeighborhood } from '../core/neighborhoods';
import { useGameStore } from '../state/gameStore';
import { FOUNDER_CATALOG } from '../world/pixelArt';
import { getStandingSprites } from './assets';

/** "Choose Your Founder" character-select overlay (also the game's opening screen). */
export function FounderModal() {
  const open = useGameStore((s) => s.founderModalOpen);
  return open ? <FounderModalBody /> : null;
}

function FounderModalBody() {
  const actions = useGameStore((s) => s.actions);
  const founderSpecies = useGameStore((s) => s.founderSpecies);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const standingSprites = getStandingSprites();
  const neighborhood = getNeighborhood(neighborhoodId);
  const selectedFounder = FOUNDER_CATALOG.find((f) => f.id === founderSpecies) ?? FOUNDER_CATALOG[0];

  return (
    <div className="founder-backdrop" onClick={actions.closeFounderModal}>
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
            onClick={actions.closeFounderModal}
            aria-label="Close Founder Select"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="founder-intro-narration">
            A heatwave has swept Manhattan into a full-blown lemonade craze. Your parents believed in you and
            slipped <strong>$30</strong> into your hand to kickstart your business—lease a corner, stock up at
            Union Square Market, and build a New York empire in 30 days.
          </p>
          <div className="founder-grid">
            {FOUNDER_CATALOG.map((founder) => {
              const isSelected = founder.id === founderSpecies;
              return (
                <button
                  key={founder.id}
                  type="button"
                  className={`founder-card ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => actions.pickFounder(founder.id)}
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
            onClick={actions.startFromFounderModal}
          >
            Open My Stand →
          </button>
        </div>
      </div>
    </div>
  );
}
