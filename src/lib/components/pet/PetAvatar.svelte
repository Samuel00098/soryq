<!-- PetAvatar.svelte -->
<script lang="ts">
  let { type, status, skin } = $props<{
    type: 'cat' | 'slime' | 'robo';
    status: 'idle' | 'typing' | 'sleep' | 'commit' | 'happy' | 'eating';
    skin: string;
  }>();
</script>

<div class="pet-avatar-wrapper type-{type} status-{status}">
  <div class="pet-glow" aria-hidden="true"></div>
  {#if type === 'slime'}
    <svg class="pet-svg slime-svg" viewBox="0 0 100 100" width="100%" height="100%">
      <!-- Slime Body shadow -->
      <ellipse class="pet-ground-shadow" cx="50" cy="85" rx="30" ry="8" />

      <!-- Slime Body -->
      <path
        class="slime-body"
        d="M 20 75 Q 20 40 50 35 Q 80 40 80 75 Q 80 82 50 82 Q 20 82 20 75 Z"
        fill="var(--accent)"
      />

      <!-- Glow highlight -->
      <path
        d="M 30 50 Q 50 42 65 48"
        stroke="rgba(255,255,255,0.35)"
        stroke-width="3"
        stroke-linecap="round"
        fill="none"
      />

      <!-- Slime Face -->
      <g class="slime-face">
        {#if status === 'sleep'}
          <!-- Sleeping eyes -->
          <path d="M 35 60 Q 40 65 45 60" stroke="var(--bg-primary)" stroke-width="2.5" stroke-linecap="round" fill="none" />
          <path d="M 55 60 Q 60 65 65 60" stroke="var(--bg-primary)" stroke-width="2.5" stroke-linecap="round" fill="none" />
          <path d="M 47 70 Q 50 72 53 70" stroke="var(--bg-primary)" stroke-width="1.5" stroke-linecap="round" fill="none" />
        {:else if status === 'commit' || status === 'happy'}
          <!-- Happy winking or smiling face -->
          <path d="M 32 58 Q 40 50 42 60" stroke="var(--bg-primary)" stroke-width="3" stroke-linecap="round" fill="none" />
          <path d="M 58 58 Q 60 50 68 60" stroke="var(--bg-primary)" stroke-width="3" stroke-linecap="round" fill="none" />
          <!-- Open smiling mouth -->
          <path d="M 45 68 Q 50 78 55 68 Z" fill="var(--error)" stroke="var(--bg-primary)" stroke-width="1.5" />
        {:else if status === 'eating'}
          <!-- Open chewing mouth -->
          <circle cx="38" cy="58" r="4.5" fill="var(--bg-primary)" />
          <circle cx="62" cy="58" r="4.5" fill="var(--bg-primary)" />
          <ellipse cx="50" cy="70" rx="9" ry="6" fill="var(--bg-primary)" />
          <circle cx="50" cy="70" r="4" fill="var(--error)" />
        {:else}
          <!-- Standard face -->
          <circle class="eye-left" cx="38" cy="58" r="3.5" fill="var(--bg-primary)" />
          <circle class="eye-right" cx="62" cy="58" r="3.5" fill="var(--bg-primary)" />
          <path d="M 47 66 Q 50 69 53 66" stroke="var(--bg-primary)" stroke-width="2" stroke-linecap="round" fill="none" />
        {/if}

        <!-- Cute blushing cheeks -->
        {#if status !== 'sleep'}
          <ellipse cx="28" cy="65" rx="5" ry="3" fill="rgba(244, 63, 94, 0.45)" />
          <ellipse cx="72" cy="65" rx="5" ry="3" fill="rgba(244, 63, 94, 0.45)" />
        {/if}
      </g>

      <!-- Food item flying in during eating -->
      {#if status === 'eating'}
        <g class="food-particle">
          <circle cx="50" cy="20" r="4" fill="#fbbf24" />
        </g>
      {/if}

      <!-- Accessories on Slime -->
      <g class="pet-accessory slime-acc">
        {#if skin === 'glasses'}
          <!-- Sunglasses -->
          <path d="M 28 53 L 72 53" stroke="var(--text-primary)" stroke-width="2" />
          <rect x="30" y="52" width="16" height="11" rx="4" fill="var(--bg-primary)" stroke="var(--text-primary)" stroke-width="1.5" />
          <rect x="54" y="52" width="16" height="11" rx="4" fill="var(--bg-primary)" stroke="var(--text-primary)" stroke-width="1.5" />
          <!-- Glare line -->
          <line x1="33" y1="55" x2="38" y2="60" stroke="white" stroke-width="1.5" stroke-linecap="round" />
          <line x1="57" y1="55" x2="62" y2="60" stroke="white" stroke-width="1.5" stroke-linecap="round" />
        {:else if skin === 'headset'}
          <!-- Developer Headset -->
          <path d="M 20 75 C 15 40 85 40 80 75" fill="none" stroke="#22d3ee" stroke-width="5" stroke-linecap="round" />
          <rect x="15" y="62" width="10" height="16" rx="4" fill="#a78bfa" stroke="#22d3ee" stroke-width="1.5" />
          <rect x="75" y="62" width="10" height="16" rx="4" fill="#a78bfa" stroke="#22d3ee" stroke-width="1.5" />
          <!-- Mic -->
          <path d="M 22 75 Q 32 82 35 78" stroke="#22d3ee" stroke-width="2" fill="none" />
        {:else if skin === 'crown'}
          <!-- Golden Crown -->
          <path d="M 38 36 L 43 24 L 50 30 L 57 24 L 62 36 Z" fill="#fbbf24" stroke="#d97706" stroke-width="1.5" />
          <circle cx="43" cy="23" r="1.5" fill="#ef4444" />
          <circle cx="50" cy="29" r="1.5" fill="#3b82f6" />
          <circle cx="57" cy="23" r="1.5" fill="#10b981" />
        {:else if skin === 'detective'}
          <!-- Detective Cap -->
          <path d="M 32 38 C 32 24 68 24 68 38 Z" fill="#78350f" stroke="#451a03" stroke-width="1.5" />
          <path d="M 30 38 L 70 38 Q 74 38 72 41 L 68 41 L 32 41 Z" fill="#451a03" />
        {/if}
      </g>
    </svg>
  {:else if type === 'cat'}
    <svg class="pet-svg cat-svg" viewBox="0 0 100 100" width="100%" height="100%">
      <!-- Cat shadow -->
      <ellipse class="pet-ground-shadow" cx="50" cy="85" rx="28" ry="7" />

      <!-- Tail -->
      <path class="cat-tail" d="M 72 75 Q 85 70 80 50 Q 76 42 82 40" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" />

      <!-- Cat Body -->
      <path class="cat-body" d="M 26 78 C 26 55 74 55 74 78 Z" fill="var(--accent)" />

      <!-- Head & Ears -->
      <g class="cat-head">
        <!-- Ears -->
        <polygon points="25,40 38,20 43,38" fill="var(--accent)" />
        <polygon points="28,37 36,24 40,36" fill="#fda4af" /> <!-- inner ear L -->

        <polygon points="75,40 62,20 57,38" fill="var(--accent)" />
        <polygon points="72,37 64,24 60,36" fill="#fda4af" /> <!-- inner ear R -->

        <!-- Face Base -->
        <ellipse cx="50" cy="48" rx="24" ry="18" fill="var(--accent)" />

        <!-- Face Details -->
        {#if status === 'sleep'}
          <!-- Sleeping eyes -->
          <path d="M 36 48 Q 40 52 44 48" stroke="var(--bg-primary)" stroke-width="2.5" stroke-linecap="round" fill="none" />
          <path d="M 56 48 Q 60 52 64 48" stroke="var(--bg-primary)" stroke-width="2.5" stroke-linecap="round" fill="none" />
          <!-- Small mouth -->
          <path d="M 48 56 Q 50 58 52 56" stroke="var(--bg-primary)" stroke-width="1.5" stroke-linecap="round" fill="none" />
        {:else if status === 'commit' || status === 'happy'}
          <!-- Happy winking eyes -->
          <path d="M 34 46 Q 40 40 42 50" stroke="var(--bg-primary)" stroke-width="3" stroke-linecap="round" fill="none" />
          <path d="M 58 46 Q 60 40 66 50" stroke="var(--bg-primary)" stroke-width="3" stroke-linecap="round" fill="none" />
          <!-- Happy mouth -->
          <path d="M 46 54 Q 50 58 54 54" stroke="var(--bg-primary)" stroke-width="2.2" stroke-linecap="round" fill="none" />
        {:else if status === 'eating'}
          <!-- Chewing face -->
          <circle cx="38" cy="46" r="3" fill="var(--bg-primary)" />
          <circle cx="62" cy="46" r="3" fill="var(--bg-primary)" />
          <ellipse cx="50" cy="56" rx="5" ry="4" fill="var(--bg-primary)" />
        {:else}
          <!-- Regular face -->
          <circle cx="38" cy="46" r="3" fill="var(--bg-primary)" />
          <circle cx="62" cy="46" r="3" fill="var(--bg-primary)" />
          <!-- Nose -->
          <polygon points="48,51 52,51 50,53" fill="#fda4af" />
          <!-- Mouth -->
          <path d="M 46 55 Q 50 58 50 55 Q 50 58 54 55" stroke="var(--bg-primary)" stroke-width="1.8" stroke-linecap="round" fill="none" />
        {/if}

        <!-- Whiskers -->
        <line x1="22" y1="48" x2="10" y2="46" stroke="var(--bg-primary)" stroke-width="1.2" />
        <line x1="22" y1="51" x2="12" y2="52" stroke="var(--bg-primary)" stroke-width="1.2" />

        <line x1="78" y1="48" x2="90" y2="46" stroke="var(--bg-primary)" stroke-width="1.2" />
        <line x1="78" y1="51" x2="88" y2="52" stroke="var(--bg-primary)" stroke-width="1.2" />

        <!-- Rosy Cheeks -->
        {#if status !== 'sleep'}
          <circle cx="28" cy="51" r="3" fill="rgba(244,63,94,0.45)" />
          <circle cx="72" cy="51" r="3" fill="rgba(244,63,94,0.45)" />
        {/if}

        <!-- Accessories on Cat Head -->
        <g class="pet-accessory cat-acc">
          {#if skin === 'glasses'}
            <!-- Glasses -->
            <path d="M 28 44 L 72 44" stroke="var(--text-primary)" stroke-width="2" />
            <rect x="30" y="40" width="16" height="11" rx="3" fill="var(--bg-primary)" stroke="var(--text-primary)" stroke-width="1.5" />
            <rect x="54" y="40" width="16" height="11" rx="3" fill="var(--bg-primary)" stroke="var(--text-primary)" stroke-width="1.5" />
            <line x1="33" y1="43" x2="37" y2="47" stroke="white" stroke-width="1.5" stroke-linecap="round" />
            <line x1="57" y1="43" x2="61" y2="47" stroke="white" stroke-width="1.5" stroke-linecap="round" />
          {:else if skin === 'headset'}
            <!-- Developer Headset -->
            <path d="M 24 48 C 18 18 82 18 76 48" fill="none" stroke="#fb7185" stroke-width="4.5" stroke-linecap="round" />
            <rect x="18" y="40" width="8" height="14" rx="3" fill="#a78bfa" stroke="#fb7185" stroke-width="1" />
            <rect x="74" y="40" width="8" height="14" rx="3" fill="#a78bfa" stroke="#fb7185" stroke-width="1" />
            <path d="M 23 48 Q 30 54 33 51" stroke="#fb7185" stroke-width="1.5" fill="none" />
          {:else if skin === 'crown'}
            <!-- Golden Crown -->
            <path d="M 40 28 L 44 18 L 50 23 L 56 18 L 60 28 Z" fill="#fbbf24" stroke="#d97706" stroke-width="1.2" />
            <circle cx="44" cy="17.5" r="1" fill="#ef4444" />
            <circle cx="50" cy="22" r="1" fill="#3b82f6" />
            <circle cx="56" cy="17.5" r="1" fill="#10b981" />
          {:else if skin === 'detective'}
            <!-- Detective Cap -->
            <path d="M 34 30 C 34 16 66 16 66 30 Z" fill="#78350f" stroke="#451a03" stroke-width="1.2" />
            <path d="M 32 30 L 68 30 Q 72 30 70 33 L 66 33 L 34 33 Z" fill="#451a03" />
          {/if}
        </g>
      </g>

      <!-- Hands / Paws / Keyboard -->
      {#if status === 'typing'}
        <!-- Tiny Keyboard -->
        <rect class="cat-keyboard" x="30" y="74" width="40" height="12" rx="3" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="1.5" />
        <!-- Key rows simulated -->
        <line x1="34" y1="78" x2="66" y2="78" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="2 1" />
        <line x1="34" y1="82" x2="66" y2="82" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="3 1" />

        <!-- Typing paws -->
        <circle class="cat-paw paw-left" cx="36" cy="74" r="5" fill="var(--accent)" stroke="var(--bg-primary)" stroke-width="1.2" />
        <circle class="cat-paw paw-right" cx="64" cy="74" r="5" fill="var(--accent)" stroke="var(--bg-primary)" stroke-width="1.2" />
      {/if}
      
      {#if status === 'eating'}
        <!-- Flying fish bone -->
        <path class="cat-food" d="M 50 18 L 50 30 M 45 21 L 55 21 M 43 25 L 57 25 M 46 29 L 54 29" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" />
      {/if}
    </svg>
  {:else if type === 'robo'}
    <svg class="pet-svg robo-svg" viewBox="0 0 100 100" width="100%" height="100%">
      <!-- Robo shadow -->
      <ellipse class="pet-ground-shadow" cx="50" cy="85" rx="22" ry="5" />

      <!-- Floating propulsion trail -->
      {#if status !== 'sleep'}
        <path class="robo-propulsion" d="M 46 72 L 50 82 L 54 72 Z" fill="#34d399" opacity="0.8" />
        <path class="robo-propulsion-inner" d="M 48 72 L 50 78 L 52 72 Z" fill="#e0f2fe" opacity="0.9" />
      {/if}

      <!-- Main Body / Head -->
      <g class="robo-body">
        <!-- Floating neck connector -->
        <rect x="47" y="62" width="6" height="8" rx="2" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="1.5" />

        <!-- Side Thrusters -->
        <ellipse cx="25" cy="55" rx="5" ry="8" fill="var(--accent)" stroke="var(--border)" stroke-width="1.5" />
        <ellipse cx="75" cy="55" rx="5" ry="8" fill="var(--accent)" stroke="var(--border)" stroke-width="1.5" />

        <!-- Antenna -->
        <line x1="50" y1="30" x2="50" y2="18" stroke="var(--border)" stroke-width="2.5" />
        <circle class="robo-antenna-tip" cx="50" cy="16" r="3.5" fill="#34d399" stroke="var(--border)" stroke-width="1" />

        <!-- Robot Screen Head -->
        <rect x="28" y="28" width="44" height="36" rx="8" fill="var(--accent)" stroke="var(--border)" stroke-width="2" />

        <!-- Face Screen -->
        <rect x="33" y="33" width="34" height="26" rx="4" fill="var(--bg-primary)" stroke="var(--border-subtle)" stroke-width="1.5" />

        <!-- Eyes and Screen indicators -->
        {#if status === 'sleep'}
          <!-- Offline/Sleeping eyes -->
          <line x1="38" y1="46" x2="44" y2="46" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" />
          <line x1="56" y1="46" x2="62" y2="46" stroke="#34d399" stroke-width="2.5" stroke-linecap="round" />
          <text x="50" y="55" fill="#34d399" font-size="6" font-family="monospace" text-anchor="middle" opacity="0.7">ZZZ</text>
        {:else if status === 'commit' || status === 'happy'}
          <!-- Success screen -->
          <path d="M 43 45 L 48 50 L 58 40" stroke="#34d399" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none" />
          <text x="50" y="56" fill="#34d399" font-size="5" font-family="monospace" text-anchor="middle" font-weight="bold">OK</text>
        {:else if status === 'typing'}
          <!-- Coding eyes / digital code lines -->
          <rect x="38" y="38" width="10" height="2" fill="#34d399" />
          <rect x="52" y="38" width="10" height="2" fill="#34d399" />
          <text x="50" y="52" fill="#34d399" font-size="6.5" font-family="monospace" text-anchor="middle" class="typing-symbols">&lt;/&gt;</text>
        {:else if status === 'eating'}
          <!-- Eating screen -->
          <circle cx="40" cy="45" r="2.5" fill="#34d399" />
          <circle cx="60" cy="45" r="2.5" fill="#34d399" />
          <!-- Mouth -->
          <path d="M 45 52 Q 50 56 55 52" stroke="#34d399" stroke-width="2" stroke-linecap="round" fill="none" />
        {:else}
          <!-- Regular floating screen eyes -->
          <circle class="robo-eye" cx="42" cy="44" r="3" fill="#34d399" />
          <circle class="robo-eye" cx="58" cy="44" r="3" fill="#34d399" />
          <!-- Status line -->
          <line x1="42" y1="52" x2="58" y2="52" stroke="#34d399" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="1 2" />
        {/if}
      </g>

      <!-- Binary floaties when typing -->
      {#if status === 'typing'}
        <text class="robo-binary b1" x="15" y="35" fill="#34d399" font-size="7" font-family="monospace">1</text>
        <text class="robo-binary b2" x="85" y="45" fill="#34d399" font-size="7" font-family="monospace">0</text>
        <text class="robo-binary b3" x="20" y="65" fill="#34d399" font-size="7" font-family="monospace">0</text>
        <text class="robo-binary b4" x="80" y="25" fill="#34d399" font-size="7" font-family="monospace">1</text>
      {/if}

      {#if status === 'eating'}
        <!-- Battery charger energy cell -->
        <rect class="robo-battery" x="46" y="14" width="8" height="12" fill="#10b981" rx="1" />
        <rect x="48" y="11" width="4" height="3" fill="#10b981" />
      {/if}

      <!-- Accessories on Robo Head -->
      <g class="pet-accessory robo-acc">
        {#if skin === 'glasses'}
          <!-- Neon Glasses -->
          <rect x="31" y="38" width="38" height="10" rx="2" fill="none" stroke="#a78bfa" stroke-width="2" />
          <line x1="50" y1="38" x2="50" y2="48" stroke="#a78bfa" stroke-width="1.5" />
          <!-- Neon glare -->
          <line x1="33" y1="41" x2="37" y2="45" stroke="white" stroke-width="1.5" stroke-linecap="round" />
          <line x1="63" y1="41" x2="67" y2="45" stroke="white" stroke-width="1.5" stroke-linecap="round" />
        {:else if skin === 'headset'}
          <!-- Gamer Headset on Robo -->
          <path d="M 28 34 C 20 8 80 8 72 34" fill="none" stroke="#22d3ee" stroke-width="4" stroke-linecap="round" />
          <rect x="22" y="32" width="6" height="12" rx="2" fill="#22d3ee" />
          <rect x="72" y="32" width="6" height="12" rx="2" fill="#22d3ee" />
          <path d="M 25 40 Q 30 45 32 43" stroke="#22d3ee" stroke-width="1.5" fill="none" />
        {:else if skin === 'crown'}
          <!-- Golden Crown on Robo Antenna -->
          <path d="M 40 21 L 43 12 L 50 17 L 57 12 L 60 21 Z" fill="#fbbf24" stroke="#d97706" stroke-width="1" />
          <circle cx="43" cy="11.5" r="0.8" fill="#ef4444" />
          <circle cx="50" cy="16" r="0.8" fill="#3b82f6" />
          <circle cx="57" cy="11.5" r="0.8" fill="#10b981" />
        {:else if skin === 'detective'}
          <!-- Detective Hat on Robo -->
          <path d="M 33 28 C 33 16 67 16 67 28 Z" fill="#78350f" stroke="#451a03" stroke-width="1" />
          <path d="M 30 28 L 70 28 Q 74 28 72 31 L 68 31 L 32 31 Z" fill="#451a03" />
        {/if}
      </g>
    </svg>
  {/if}

  <!-- Sleep Zzz floating animation -->
  {#if status === 'sleep'}
    <div class="zzz-container">
      <span class="zzz z1">z</span>
      <span class="zzz z2">Z</span>
      <span class="zzz z3">z</span>
    </div>
  {/if}
</div>

<style>
  .pet-avatar-wrapper {
    --pet-glow-color: var(--accent);
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    isolation: isolate;
  }

  .type-cat {
    --accent: #f59e0b;
    --pet-glow-color: #fbbf24;
  }

  .type-slime {
    --accent: #14b8a6;
    --pet-glow-color: #5eead4;
  }

  .type-robo {
    --accent: #60a5fa;
    --pet-glow-color: #a78bfa;
  }

  .pet-glow {
    position: absolute;
    inset: 16%;
    z-index: -1;
    border-radius: 999px;
    background:
      radial-gradient(circle at 42% 34%, rgba(255, 255, 255, 0.5), transparent 28%),
      radial-gradient(circle, color-mix(in srgb, var(--pet-glow-color) 42%, transparent), transparent 68%);
    filter: blur(10px);
    opacity: 0.68;
    transform: translateY(8px);
    pointer-events: none;
  }

  .pet-svg {
    display: block;
    max-width: 150px;
    max-height: 150px;
    overflow: visible;
    filter: drop-shadow(0 13px 18px rgba(0, 0, 0, 0.16));
  }

  .pet-ground-shadow {
    fill: rgba(0, 0, 0, 0.16);
  }

  .status-happy .pet-glow,
  .status-commit .pet-glow {
    animation: glow-pulse 0.9s ease-in-out infinite alternate;
    opacity: 0.9;
  }

  .status-typing .pet-glow {
    opacity: 0.78;
    filter: blur(8px);
  }

  .status-sleep .pet-glow {
    opacity: 0.34;
  }

  @keyframes glow-pulse {
    from { transform: translateY(9px) scale(0.96); }
    to { transform: translateY(6px) scale(1.08); }
  }

  /* ─── Shared keyframes ────────────────── */
  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }

  @keyframes breathing {
    0%, 100% { transform: scale(1) translateY(0); }
    50% { transform: scale(1.02, 0.98) translateY(1px); }
  }

  @keyframes intense-bounce {
    0%, 100% { transform: translateY(0) scale(1); }
    50% { transform: translateY(-8px) scale(0.96, 1.04); }
  }

  @keyframes spin-jump {
    0% { transform: translateY(0) rotate(0deg); }
    30% { transform: translateY(-20px) rotate(180deg); }
    60% { transform: translateY(-20px) rotate(360deg); }
    100% { transform: translateY(0) rotate(360deg); }
  }

  @keyframes tail-wag {
    0%, 100% { transform: rotate(0); }
    50% { transform: rotate(15deg); }
  }

  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
  }

  @keyframes type-paw {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }

  /* ─── State Animation Mapping ────────── */
  
  /* Slime State Animations */
  .slime-body {
    transform-origin: bottom center;
  }
  .status-idle .slime-body {
    animation: breathing 2s ease-in-out infinite;
  }
  .status-typing .slime-body {
    animation: intense-bounce 0.25s ease-in-out infinite;
  }
  .status-sleep .slime-body {
    animation: breathing 3.5s ease-in-out infinite;
    opacity: 0.85;
  }
  .status-commit .slime-svg,
  .status-happy .slime-svg {
    animation: spin-jump 0.8s cubic-bezier(0.25, 1, 0.5, 1) infinite;
  }
  .status-eating .slime-body {
    animation: breathing 0.8s ease-in-out infinite;
  }

  /* Cat State Animations */
  .cat-head, .cat-body, .cat-tail {
    transform-origin: bottom center;
  }
  .status-idle .cat-head {
    animation: bounce 2.5s ease-in-out infinite;
  }
  .status-idle .cat-tail {
    animation: tail-wag 1.5s ease-in-out infinite;
  }
  .status-typing .cat-head {
    animation: bounce 0.4s ease-in-out infinite;
  }
  .status-typing .paw-left {
    animation: type-paw 0.15s ease-in-out infinite alternate;
  }
  .status-typing .paw-right {
    animation: type-paw 0.15s ease-in-out infinite alternate-reverse;
  }
  .status-sleep .cat-head, .status-sleep .cat-body {
    animation: breathing 4s ease-in-out infinite;
    opacity: 0.8;
  }
  .status-commit .cat-svg,
  .status-happy .cat-svg {
    animation: intense-bounce 0.4s ease-in-out infinite alternate;
  }

  /* Robo State Animations */
  .robo-body {
    transform-origin: bottom center;
  }
  .status-idle .robo-svg {
    animation: float 2.5s ease-in-out infinite;
  }
  .status-typing .robo-svg {
    animation: float 0.8s ease-in-out infinite;
  }
  .status-typing .typing-symbols {
    animation: bounce 0.3s ease infinite;
  }
  .status-sleep .robo-svg {
    animation: float 4.5s ease-in-out infinite;
    opacity: 0.75;
  }
  .status-commit .robo-body,
  .status-happy .robo-body {
    animation: spin-jump 0.8s cubic-bezier(0.25, 1, 0.5, 1) 1;
  }

  /* Accessories follow head/body transforms */
  .pet-accessory {
    transform-origin: bottom center;
  }

  /* Floating Zzz animations */
  .zzz-container {
    position: absolute;
    top: 10px;
    right: 25px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    pointer-events: none;
  }

  .zzz {
    font-family: 'Outfit', sans-serif;
    font-weight: bold;
    color: var(--text-muted);
    font-size: 10px;
    opacity: 0;
    animation: zzz-float 3s infinite linear;
  }

  .z1 { animation-delay: 0s; }
  .z2 { animation-delay: 1s; font-size: 13px; }
  .z3 { animation-delay: 2s; }

  @keyframes zzz-float {
    0% { transform: translate(0, 10px) scale(0.8); opacity: 0; }
    20% { opacity: 0.7; }
    80% { opacity: 0.5; }
    100% { transform: translate(15px, -20px) scale(1.2); opacity: 0; }
  }

  /* Food particles */
  @keyframes food-fall {
    0% { transform: translateY(-20px); opacity: 1; }
    100% { transform: translateY(35px); opacity: 0; }
  }
  .food-particle {
    animation: food-fall 1s linear infinite;
  }
  .cat-food {
    animation: food-fall 0.8s linear infinite;
    transform-origin: center;
  }

  /* Binary symbols */
  @keyframes binary-rise {
    0% { transform: translateY(15px); opacity: 0; }
    20% { opacity: 0.8; }
    80% { opacity: 0.8; }
    100% { transform: translateY(-15px); opacity: 0; }
  }
  .robo-binary {
    animation: binary-rise 1.2s ease-in-out infinite;
    opacity: 0;
  }
  .b1 { animation-delay: 0s; }
  .b2 { animation-delay: 0.3s; }
  .b3 { animation-delay: 0.6s; }
  .b4 { animation-delay: 0.9s; }
</style>
