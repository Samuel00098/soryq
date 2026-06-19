import { useMemo, useState } from 'react';
import { useStore } from '$lib/react/useStore';
import { devpet } from '$lib/stores/devpet';
import { showToast } from '$lib/stores/notification';
import PetAvatar from './PetAvatar.tsx';
import './DevPetPanel.css';

const companionTypes = [
  { id: 'cat' as const, label: 'Cat', desc: 'Warm and focused' },
  { id: 'slime' as const, label: 'Slime', desc: 'Soft and lively' },
  { id: 'robo' as const, label: 'Robo', desc: 'Sharp and precise' },
];

export default function DevPetPanel() {
  const pet = useStore(devpet);
  const [renameMode, setRenameMode] = useState(false);
  const [newName, setNewName] = useState('');

  const bubbleText = useMemo(() => {
    switch (pet.status) {
      case 'sleep':
        return 'zZz... recharging quietly.';
      case 'typing':
        return pet.wpm > 60 ? `Fast flow: ${pet.wpm} WPM.` : `Typing rhythm: ${pet.wpm} WPM.`;
      case 'commit':
        return 'Commit logged. Clean work.';
      case 'happy':
        return 'That hit the spot.';
      case 'eating':
        return 'Snack break accepted.';
      case 'idle':
      default:
        return 'Ready when you are.';
    }
  }, [pet.status, pet.wpm]);

  const xpDisplay = Math.round(pet.xp);
  const xpToNextDisplay = Math.round(pet.xpToNextLevel);
  const xpProgress = Math.max(0, Math.min(100, (pet.xp / Math.max(1, pet.xpToNextLevel)) * 100));
  const xpRemaining = Math.max(0, xpToNextDisplay - xpDisplay);

  function handleFeed() {
    if (pet.coins < 10) {
      showToast('Not enough coins. Write more code to earn coins.', 'warning');
      return;
    }
    const success = devpet.feed();
    if (success) {
      showToast(`${pet.name} enjoyed the snack. (+15 XP)`, 'success');
    }
  }

  function handlePet() {
    devpet.pet();
  }

  function startRename() {
    setNewName(pet.name);
    setRenameMode(true);
  }

  function saveRename() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    devpet.rename(trimmed);
    setRenameMode(false);
    showToast(`Renamed companion to ${trimmed}.`, 'success');
  }

  function switchType(type: 'cat' | 'slime' | 'robo') {
    devpet.setType(type);
    showToast(`Switched companion to ${type}.`, 'info');
  }

  return (
    <div className="devpet-panel">
      <div className="devpet-container scrollable">
        <section className="pet-hero" aria-label="DevPet companion">
          <div className="pet-hero-topline">
            <span className="eyebrow">DevPet</span>
            <span className="status-pill" data-status={pet.status}>{pet.status}</span>
          </div>

          <div className="pet-stage-shell">
            <div className="pet-bubble" aria-live="polite">{bubbleText}</div>

            <button className="pet-avatar-stage" onClick={handlePet} title="Pet companion" aria-label={`Pet ${pet.name}`} style={{ pointerEvents: 'auto' }}>
              <div style={{ pointerEvents: 'none' }}>
                <PetAvatar type={pet.type} status={pet.status} skin={pet.skin} />
              </div>
            </button>

            {pet.status === 'happy' && (
              <>
                <span key="sparkle-1" className="sparkle s1"></span>
                <span key="sparkle-2" className="sparkle s2"></span>
                <span key="sparkle-3" className="sparkle s3"></span>
              </>
            )}
          </div>

          <div className="pet-identity">
            {renameMode ? (
              <div className="rename-row">
                <input
                  type="text"
                  className="rename-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={16}
                  onKeyDown={(e) => e.key === 'Enter' && saveRename()}
                  aria-label="New companion name"
                />
                <button className="action-btn-sm save-btn" onClick={saveRename}>Save</button>
                <button className="action-btn-sm cancel-btn" onClick={() => setRenameMode(false)}>Cancel</button>
              </div>
            ) : (
              <div className="name-display">
                <h2>{pet.name}</h2>
                <button className="edit-btn" onClick={startRename} aria-label="Rename companion">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </button>
              </div>
            )}
            <span className="type-badge">Level {pet.level} {pet.type}</span>
          </div>

          <div className="hero-metrics">
            <div className="metric-chip">
              <span className="metric-label">Coins</span>
              <span className="metric-value">{pet.coins}</span>
            </div>
            <div className="metric-chip">
              <span className="metric-label">WPM</span>
              <span className="metric-value">{pet.wpm}</span>
            </div>
            <div className="metric-chip">
              <span className="metric-label">XP</span>
              <span className="metric-value">{xpDisplay}</span>
            </div>
          </div>
        </section>

        <div className="devpet-aside">
          <section className="progress-card bento-card">
            <div className="section-heading">
              <span>Progress</span>
              <strong>{xpDisplay} / {xpToNextDisplay} XP</strong>
            </div>
            <div className="progress-container" aria-label="Experience progress">
              <div className="progress-bar" style={{ width: `${xpProgress}%` }}></div>
            </div>
            <p className="stat-footer">Need {xpRemaining} XP to level up</p>
          </section>

          <section className="controls-grid">
            <div className="bento-card care-card">
              <div className="section-heading">
                <span>Care</span>
                <strong>{pet.totalFeedCount} snacks</strong>
              </div>
              <div className="care-buttons">
                <button className="action-btn feed-btn" onClick={handleFeed} disabled={pet.coins < 10}>
                  <span className="btn-icon" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 11a8 8 0 0 1 16 0" />
                      <path d="M3 11h18" />
                      <path d="M5 15h14" />
                      <path d="M6 19h12" />
                    </svg>
                  </span>
                  <span>Feed snack</span>
                  <small>10 coins</small>
                </button>

                <button className="action-btn play-btn" onClick={handlePet}>
                  <span className="btn-icon" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.7-7.7 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z" />
                    </svg>
                  </span>
                  <span>Pet companion</span>
                  <small>Free</small>
                </button>
              </div>
            </div>

            <div className="bento-card type-card">
              <div className="section-heading">
                <span>Companion</span>
                <strong>{pet.type}</strong>
              </div>
              <div className="type-grid">
                {companionTypes.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`type-btn${pet.type === option.id ? ' active' : ''}`}
                    onClick={() => switchType(option.id)}
                  >
                    <span>{option.label}</span>
                    <small>{option.desc}</small>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="bento-card stats-overview">
            <div className="section-heading">
              <span>Workspace stats</span>
              <strong>Lifetime</strong>
            </div>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="val">{pet.totalCharactersTyped.toLocaleString()}</span>
                <span className="lbl">Characters</span>
              </div>
              <div className="stat-item">
                <span className="val">{pet.totalCommits}</span>
                <span className="lbl">Commits</span>
              </div>
              <div className="stat-item">
                <span className="val">{pet.totalFeedCount}</span>
                <span className="lbl">Snacks</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
