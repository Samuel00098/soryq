import './PetAvatar.css';

type PetType = 'cat' | 'slime' | 'robo';
type PetStatus = 'idle' | 'typing' | 'sleep' | 'commit' | 'happy' | 'eating';

interface Props {
  type: PetType;
  status: PetStatus;
  skin: string;
}

export default function PetAvatar({ type, status, skin }: Props) {
  return (
    <div className={`pet-avatar-wrapper type-${type} status-${status}`}>
      <div className="pet-glow" aria-hidden="true"></div>

      {type === 'slime' && (
        <svg className="pet-svg slime-svg" viewBox="0 0 100 100" width="100%" height="100%">
          <ellipse className="pet-ground-shadow" cx="50" cy="85" rx="30" ry="8" />

          <path
            className="slime-body"
            d="M 20 75 Q 20 40 50 35 Q 80 40 80 75 Q 80 82 50 82 Q 20 82 20 75 Z"
            fill="var(--accent)"
          />

          <path d="M 30 50 Q 50 42 65 48" stroke="rgba(255,255,255,0.35)" strokeWidth="3" strokeLinecap="round" fill="none" />

          <g className="slime-face">
            {status === 'sleep' ? (
              <>
                <path d="M 35 60 Q 40 65 45 60" stroke="var(--bg-primary)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                <path d="M 55 60 Q 60 65 65 60" stroke="var(--bg-primary)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                <path d="M 47 70 Q 50 72 53 70" stroke="var(--bg-primary)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              </>
            ) : status === 'commit' || status === 'happy' ? (
              <>
                <path d="M 32 58 Q 40 50 42 60" stroke="var(--bg-primary)" strokeWidth="3" strokeLinecap="round" fill="none" />
                <path d="M 58 58 Q 60 50 68 60" stroke="var(--bg-primary)" strokeWidth="3" strokeLinecap="round" fill="none" />
                <path d="M 45 68 Q 50 78 55 68 Z" fill="var(--error)" stroke="var(--bg-primary)" strokeWidth="1.5" />
              </>
            ) : status === 'eating' ? (
              <>
                <circle cx="38" cy="58" r="4.5" fill="var(--bg-primary)" />
                <circle cx="62" cy="58" r="4.5" fill="var(--bg-primary)" />
                <ellipse cx="50" cy="70" rx="9" ry="6" fill="var(--bg-primary)" />
                <circle cx="50" cy="70" r="4" fill="var(--error)" />
              </>
            ) : (
              <>
                <circle className="eye-left" cx="38" cy="58" r="3.5" fill="var(--bg-primary)" />
                <circle className="eye-right" cx="62" cy="58" r="3.5" fill="var(--bg-primary)" />
                <path d="M 47 66 Q 50 69 53 66" stroke="var(--bg-primary)" strokeWidth="2" strokeLinecap="round" fill="none" />
              </>
            )}

            {status !== 'sleep' && (
              <>
                <ellipse cx="28" cy="65" rx="5" ry="3" fill="rgba(244, 63, 94, 0.45)" />
                <ellipse cx="72" cy="65" rx="5" ry="3" fill="rgba(244, 63, 94, 0.45)" />
              </>
            )}
          </g>

          {status === 'eating' && (
            <g className="food-particle">
              <circle cx="50" cy="20" r="4" fill="#fbbf24" />
            </g>
          )}

          <g className="pet-accessory slime-acc">
            {skin === 'glasses' ? (
              <>
                <path d="M 28 53 L 72 53" stroke="var(--text-primary)" strokeWidth="2" />
                <rect x="30" y="52" width="16" height="11" rx="4" fill="var(--bg-primary)" stroke="var(--text-primary)" strokeWidth="1.5" />
                <rect x="54" y="52" width="16" height="11" rx="4" fill="var(--bg-primary)" stroke="var(--text-primary)" strokeWidth="1.5" />
                <line x1="33" y1="55" x2="38" y2="60" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="57" y1="55" x2="62" y2="60" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
              </>
            ) : skin === 'headset' ? (
              <>
                <path d="M 20 75 C 15 40 85 40 80 75" fill="none" stroke="#22d3ee" strokeWidth="5" strokeLinecap="round" />
                <rect x="15" y="62" width="10" height="16" rx="4" fill="#a78bfa" stroke="#22d3ee" strokeWidth="1.5" />
                <rect x="75" y="62" width="10" height="16" rx="4" fill="#a78bfa" stroke="#22d3ee" strokeWidth="1.5" />
                <path d="M 22 75 Q 32 82 35 78" stroke="#22d3ee" strokeWidth="2" fill="none" />
              </>
            ) : skin === 'crown' ? (
              <>
                <path d="M 38 36 L 43 24 L 50 30 L 57 24 L 62 36 Z" fill="#fbbf24" stroke="#d97706" strokeWidth="1.5" />
                <circle cx="43" cy="23" r="1.5" fill="#ef4444" />
                <circle cx="50" cy="29" r="1.5" fill="#3b82f6" />
                <circle cx="57" cy="23" r="1.5" fill="#10b981" />
              </>
            ) : skin === 'detective' ? (
              <>
                <path d="M 32 38 C 32 24 68 24 68 38 Z" fill="#78350f" stroke="#451a03" strokeWidth="1.5" />
                <path d="M 30 38 L 70 38 Q 74 38 72 41 L 68 41 L 32 41 Z" fill="#451a03" />
              </>
            ) : null}
          </g>
        </svg>
      )}

      {type === 'cat' && (
        <svg className="pet-svg cat-svg" viewBox="0 0 100 100" width="100%" height="100%">
          <ellipse className="pet-ground-shadow" cx="50" cy="85" rx="28" ry="7" />

          <path className="cat-tail" d="M 72 75 Q 85 70 80 50 Q 76 42 82 40" fill="none" stroke="var(--accent)" strokeWidth="7" strokeLinecap="round" />

          <path className="cat-body" d="M 26 78 C 26 55 74 55 74 78 Z" fill="var(--accent)" />

          <g className="cat-head">
            <polygon points="25,40 38,20 43,38" fill="var(--accent)" />
            <polygon points="28,37 36,24 40,36" fill="#fda4af" />

            <polygon points="75,40 62,20 57,38" fill="var(--accent)" />
            <polygon points="72,37 64,24 60,36" fill="#fda4af" />

            <ellipse cx="50" cy="48" rx="24" ry="18" fill="var(--accent)" />

            {status === 'sleep' ? (
              <>
                <path d="M 36 48 Q 40 52 44 48" stroke="var(--bg-primary)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                <path d="M 56 48 Q 60 52 64 48" stroke="var(--bg-primary)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                <path d="M 48 56 Q 50 58 52 56" stroke="var(--bg-primary)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              </>
            ) : status === 'commit' || status === 'happy' ? (
              <>
                <path d="M 34 46 Q 40 40 42 50" stroke="var(--bg-primary)" strokeWidth="3" strokeLinecap="round" fill="none" />
                <path d="M 58 46 Q 60 40 66 50" stroke="var(--bg-primary)" strokeWidth="3" strokeLinecap="round" fill="none" />
                <path d="M 46 54 Q 50 58 54 54" stroke="var(--bg-primary)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
              </>
            ) : status === 'eating' ? (
              <>
                <circle cx="38" cy="46" r="3" fill="var(--bg-primary)" />
                <circle cx="62" cy="46" r="3" fill="var(--bg-primary)" />
                <ellipse cx="50" cy="56" rx="5" ry="4" fill="var(--bg-primary)" />
              </>
            ) : (
              <>
                <circle cx="38" cy="46" r="3" fill="var(--bg-primary)" />
                <circle cx="62" cy="46" r="3" fill="var(--bg-primary)" />
                <polygon points="48,51 52,51 50,53" fill="#fda4af" />
                <path d="M 46 55 Q 50 58 50 55 Q 50 58 54 55" stroke="var(--bg-primary)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
              </>
            )}

            <line x1="22" y1="48" x2="10" y2="46" stroke="var(--bg-primary)" strokeWidth="1.2" />
            <line x1="22" y1="51" x2="12" y2="52" stroke="var(--bg-primary)" strokeWidth="1.2" />

            <line x1="78" y1="48" x2="90" y2="46" stroke="var(--bg-primary)" strokeWidth="1.2" />
            <line x1="78" y1="51" x2="88" y2="52" stroke="var(--bg-primary)" strokeWidth="1.2" />

            {status !== 'sleep' && (
              <>
                <circle cx="28" cy="51" r="3" fill="rgba(244,63,94,0.45)" />
                <circle cx="72" cy="51" r="3" fill="rgba(244,63,94,0.45)" />
              </>
            )}

            <g className="pet-accessory cat-acc">
              {skin === 'glasses' ? (
                <>
                  <path d="M 28 44 L 72 44" stroke="var(--text-primary)" strokeWidth="2" />
                  <rect x="30" y="40" width="16" height="11" rx="3" fill="var(--bg-primary)" stroke="var(--text-primary)" strokeWidth="1.5" />
                  <rect x="54" y="40" width="16" height="11" rx="3" fill="var(--bg-primary)" stroke="var(--text-primary)" strokeWidth="1.5" />
                  <line x1="33" y1="43" x2="37" y2="47" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="57" y1="43" x2="61" y2="47" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                </>
              ) : skin === 'headset' ? (
                <>
                  <path d="M 24 48 C 18 18 82 18 76 48" fill="none" stroke="#fb7185" strokeWidth="4.5" strokeLinecap="round" />
                  <rect x="18" y="40" width="8" height="14" rx="3" fill="#a78bfa" stroke="#fb7185" strokeWidth="1" />
                  <rect x="74" y="40" width="8" height="14" rx="3" fill="#a78bfa" stroke="#fb7185" strokeWidth="1" />
                  <path d="M 23 48 Q 30 54 33 51" stroke="#fb7185" strokeWidth="1.5" fill="none" />
                </>
              ) : skin === 'crown' ? (
                <>
                  <path d="M 40 28 L 44 18 L 50 23 L 56 18 L 60 28 Z" fill="#fbbf24" stroke="#d97706" strokeWidth="1.2" />
                  <circle cx="44" cy="17.5" r="1" fill="#ef4444" />
                  <circle cx="50" cy="22" r="1" fill="#3b82f6" />
                  <circle cx="56" cy="17.5" r="1" fill="#10b981" />
                </>
              ) : skin === 'detective' ? (
                <>
                  <path d="M 34 30 C 34 16 66 16 66 30 Z" fill="#78350f" stroke="#451a03" strokeWidth="1.2" />
                  <path d="M 32 30 L 68 30 Q 72 30 70 33 L 66 33 L 34 33 Z" fill="#451a03" />
                </>
              ) : null}
            </g>
          </g>

          {status === 'typing' && (
            <>
              <rect className="cat-keyboard" x="30" y="74" width="40" height="12" rx="3" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5" />
              <line x1="34" y1="78" x2="66" y2="78" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="2 1" />
              <line x1="34" y1="82" x2="66" y2="82" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 1" />
              <circle className="cat-paw paw-left" cx="36" cy="74" r="5" fill="var(--accent)" stroke="var(--bg-primary)" strokeWidth="1.2" />
              <circle className="cat-paw paw-right" cx="64" cy="74" r="5" fill="var(--accent)" stroke="var(--bg-primary)" strokeWidth="1.2" />
            </>
          )}

          {status === 'eating' && (
            <path className="cat-food" d="M 50 18 L 50 30 M 45 21 L 55 21 M 43 25 L 57 25 M 46 29 L 54 29" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" />
          )}
        </svg>
      )}

      {type === 'robo' && (
        <svg className="pet-svg robo-svg" viewBox="0 0 100 100" width="100%" height="100%">
          <ellipse className="pet-ground-shadow" cx="50" cy="85" rx="22" ry="5" />

          {status !== 'sleep' && (
            <>
              <path className="robo-propulsion" d="M 46 72 L 50 82 L 54 72 Z" fill="#34d399" opacity="0.8" />
              <path className="robo-propulsion-inner" d="M 48 72 L 50 78 L 52 72 Z" fill="#e0f2fe" opacity="0.9" />
            </>
          )}

          <g className="robo-body">
            <rect x="47" y="62" width="6" height="8" rx="2" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5" />

            <ellipse cx="25" cy="55" rx="5" ry="8" fill="var(--accent)" stroke="var(--border)" strokeWidth="1.5" />
            <ellipse cx="75" cy="55" rx="5" ry="8" fill="var(--accent)" stroke="var(--border)" strokeWidth="1.5" />

            <line x1="50" y1="30" x2="50" y2="18" stroke="var(--border)" strokeWidth="2.5" />
            <circle className="robo-antenna-tip" cx="50" cy="16" r="3.5" fill="#34d399" stroke="var(--border)" strokeWidth="1" />

            <rect x="28" y="28" width="44" height="36" rx="8" fill="var(--accent)" stroke="var(--border)" strokeWidth="2" />

            <rect x="33" y="33" width="34" height="26" rx="4" fill="var(--bg-primary)" stroke="var(--border-subtle)" strokeWidth="1.5" />

            {status === 'sleep' ? (
              <>
                <line x1="38" y1="46" x2="44" y2="46" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="56" y1="46" x2="62" y2="46" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" />
                <text x="50" y="55" fill="#34d399" fontSize="6" fontFamily="monospace" textAnchor="middle" opacity="0.7">ZZZ</text>
              </>
            ) : status === 'commit' || status === 'happy' ? (
              <>
                <path d="M 43 45 L 48 50 L 58 40" stroke="#34d399" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <text x="50" y="56" fill="#34d399" fontSize="5" fontFamily="monospace" textAnchor="middle" fontWeight="bold">OK</text>
              </>
            ) : status === 'typing' ? (
              <>
                <rect x="38" y="38" width="10" height="2" fill="#34d399" />
                <rect x="52" y="38" width="10" height="2" fill="#34d399" />
                <text x="50" y="52" fill="#34d399" fontSize="6.5" fontFamily="monospace" textAnchor="middle" className="typing-symbols">{'</>'}</text>
              </>
            ) : status === 'eating' ? (
              <>
                <circle cx="40" cy="45" r="2.5" fill="#34d399" />
                <circle cx="60" cy="45" r="2.5" fill="#34d399" />
                <path d="M 45 52 Q 50 56 55 52" stroke="#34d399" strokeWidth="2" strokeLinecap="round" fill="none" />
              </>
            ) : (
              <>
                <circle className="robo-eye" cx="42" cy="44" r="3" fill="#34d399" />
                <circle className="robo-eye" cx="58" cy="44" r="3" fill="#34d399" />
                <line x1="42" y1="52" x2="58" y2="52" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1 2" />
              </>
            )}
          </g>

          {status === 'typing' && (
            <>
              <text className="robo-binary b1" x="15" y="35" fill="#34d399" fontSize="7" fontFamily="monospace">1</text>
              <text className="robo-binary b2" x="85" y="45" fill="#34d399" fontSize="7" fontFamily="monospace">0</text>
              <text className="robo-binary b3" x="20" y="65" fill="#34d399" fontSize="7" fontFamily="monospace">0</text>
              <text className="robo-binary b4" x="80" y="25" fill="#34d399" fontSize="7" fontFamily="monospace">1</text>
            </>
          )}

          {status === 'eating' && (
            <>
              <rect className="robo-battery" x="46" y="14" width="8" height="12" fill="#10b981" rx="1" />
              <rect x="48" y="11" width="4" height="3" fill="#10b981" />
            </>
          )}

          <g className="pet-accessory robo-acc">
            {skin === 'glasses' ? (
              <>
                <rect x="31" y="38" width="38" height="10" rx="2" fill="none" stroke="#a78bfa" strokeWidth="2" />
                <line x1="50" y1="38" x2="50" y2="48" stroke="#a78bfa" strokeWidth="1.5" />
                <line x1="33" y1="41" x2="37" y2="45" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="63" y1="41" x2="67" y2="45" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
              </>
            ) : skin === 'headset' ? (
              <>
                <path d="M 28 34 C 20 8 80 8 72 34" fill="none" stroke="#22d3ee" strokeWidth="4" strokeLinecap="round" />
                <rect x="22" y="32" width="6" height="12" rx="2" fill="#22d3ee" />
                <rect x="72" y="32" width="6" height="12" rx="2" fill="#22d3ee" />
                <path d="M 25 40 Q 30 45 32 43" stroke="#22d3ee" strokeWidth="1.5" fill="none" />
              </>
            ) : skin === 'crown' ? (
              <>
                <path d="M 40 21 L 43 12 L 50 17 L 57 12 L 60 21 Z" fill="#fbbf24" stroke="#d97706" strokeWidth="1" />
                <circle cx="43" cy="11.5" r="0.8" fill="#ef4444" />
                <circle cx="50" cy="16" r="0.8" fill="#3b82f6" />
                <circle cx="57" cy="11.5" r="0.8" fill="#10b981" />
              </>
            ) : skin === 'detective' ? (
              <>
                <path d="M 33 28 C 33 16 67 16 67 28 Z" fill="#78350f" stroke="#451a03" strokeWidth="1" />
                <path d="M 30 28 L 70 28 Q 74 28 72 31 L 68 31 L 32 31 Z" fill="#451a03" />
              </>
            ) : null}
          </g>
        </svg>
      )}

      {status === 'sleep' && (
        <div className="zzz-container">
          <span className="zzz z1">z</span>
          <span className="zzz z2">Z</span>
          <span className="zzz z3">z</span>
        </div>
      )}
    </div>
  );
}
