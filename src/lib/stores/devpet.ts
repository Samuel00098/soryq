import { writable, get } from 'svelte/store';

export interface DevPetState {
  name: string;
  type: 'cat' | 'slime' | 'robo';
  level: number;
  xp: number;
  xpToNextLevel: number;
  coins: number;
  skin: string;
  inventory: string[];
  status: 'idle' | 'typing' | 'sleep' | 'commit' | 'happy' | 'eating';
  totalCharactersTyped: number;
  totalCommits: number;
  totalFeedCount: number;
  wpm: number;
}

const DEFAULT_STATE: DevPetState = {
  name: 'Soryq',
  type: 'cat',
  level: 1,
  xp: 0,
  xpToNextLevel: 100,
  coins: 50, // start with some coins to get them interested!
  skin: 'default',
  inventory: ['default'],
  status: 'idle',
  totalCharactersTyped: 0,
  totalCommits: 0,
  totalFeedCount: 0,
  wpm: 0
};

const LOCAL_STORAGE_KEY = 'soryq_devpet_companion';

function loadState(): DevPetState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...parsed };
  } catch (err) {
    console.error('Failed to load DevPet state:', err);
    return DEFAULT_STATE;
  }
}

export const devPetStore = writable<DevPetState>(loadState());

// Auto-save on changes
if (typeof window !== 'undefined') {
  devPetStore.subscribe((state) => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
  });
}

// Typing history for rolling WPM calculation
let typeTimestamps: { time: number; chars: number }[] = [];
let typingTimeoutId: any = null;
let sleepTimeoutId: any = null;
let statusRestoreTimeoutId: any = null;

// Helper to calculate XP needed for a given level
function calculateXpToNext(level: number): number {
  return level * 100 + (level - 1) * 20;
}

// Helper to gain XP and handle level ups
function addXpAndCoins(state: DevPetState, xpAmount: number, coinAmount: number): DevPetState {
  let xp = state.xp + xpAmount;
  let level = state.level;
  let xpNeeded = state.xpToNextLevel;
  let leveledUp = false;

  while (xp >= xpNeeded) {
    xp -= xpNeeded;
    level += 1;
    xpNeeded = calculateXpToNext(level);
    leveledUp = true;
  }

  return {
    ...state,
    xp,
    level,
    xpToNextLevel: xpNeeded,
    coins: state.coins + coinAmount
  };
}

export const devpet = {
  subscribe: devPetStore.subscribe,

  rename(name: string) {
    if (!name.trim()) return;
    devPetStore.update((s) => ({ ...s, name: name.trim().slice(0, 16) }));
  },

  setType(type: 'cat' | 'slime' | 'robo') {
    devPetStore.update((s) => ({ ...s, type }));
  },

  onType(charCount: number) {
    if (charCount <= 0) return;
    const now = Date.now();
    typeTimestamps.push({ time: now, chars: charCount });
    
    // Prune history older than 10 seconds
    typeTimestamps = typeTimestamps.filter(t => now - t.time < 10000);

    // Calculate characters in last 10 seconds
    const totalCharsLast10Sec = typeTimestamps.reduce((sum, t) => sum + t.chars, 0);
    // WPM = (chars / 5) * (60 / 10) = chars * 1.2
    const wpm = Math.round(totalCharsLast10Sec * 1.2);

    // Gain small XP and coins (e.g., 1 XP per 10 characters, 1 coin per 20 characters)
    const xpGained = charCount * 0.1;
    const coinsGained = Math.random() < (charCount / 20) ? 1 : 0;

    devPetStore.update((s) => {
      let nextState = addXpAndCoins(s, xpGained, coinsGained);
      nextState.totalCharactersTyped += charCount;
      nextState.wpm = wpm;

      // Keep typing state active (typing anim)
      if (s.status === 'idle' || s.status === 'sleep' || s.status === 'typing') {
        nextState.status = 'typing';
      }
      return nextState;
    });

    // Reset timeouts
    if (typingTimeoutId) clearTimeout(typingTimeoutId);
    if (sleepTimeoutId) clearTimeout(sleepTimeoutId);

    // After 3 seconds of silence, return to idle
    typingTimeoutId = setTimeout(() => {
      devPetStore.update((s) => {
        if (s.status === 'typing') {
          return { ...s, status: 'idle', wpm: 0 };
        }
        return { ...s, wpm: 0 };
      });
      typeTimestamps = [];
    }, 3000);

    // After 60 seconds of silence, go to sleep
    sleepTimeoutId = setTimeout(() => {
      devPetStore.update((s) => {
        if (s.status === 'idle') {
          return { ...s, status: 'sleep' };
        }
        return s;
      });
    }, 60000);
  },

  onCommit() {
    if (statusRestoreTimeoutId) clearTimeout(statusRestoreTimeoutId);

    // Reward: 30 XP, 25 Coins
    devPetStore.update((s) => {
      let next = addXpAndCoins(s, 30, 25);
      next.totalCommits += 1;
      next.status = 'commit';
      return next;
    });

    // Restore to idle after 4 seconds
    statusRestoreTimeoutId = setTimeout(() => {
      devPetStore.update((s) => (s.status === 'commit' ? { ...s, status: 'idle' } : s));
    }, 4000);
  },

  onPush() {
    if (statusRestoreTimeoutId) clearTimeout(statusRestoreTimeoutId);

    // Reward: 15 XP, 10 Coins
    devPetStore.update((s) => {
      let next = addXpAndCoins(s, 15, 10);
      next.status = 'happy';
      return next;
    });

    statusRestoreTimeoutId = setTimeout(() => {
      devPetStore.update((s) => (s.status === 'happy' ? { ...s, status: 'idle' } : s));
    }, 3000);
  },

  feed() {
    const cost = 10;
    const currentCoins = get(devPetStore).coins;
    if (currentCoins < cost) return false;

    if (statusRestoreTimeoutId) clearTimeout(statusRestoreTimeoutId);

    devPetStore.update((s) => {
      let next = {
        ...s,
        coins: s.coins - cost,
        totalFeedCount: s.totalFeedCount + 1,
        status: 'eating' as const
      };
      // Feed awards 15 XP!
      return addXpAndCoins(next, 15, 0);
    });

    statusRestoreTimeoutId = setTimeout(() => {
      devPetStore.update((s) => (s.status === 'eating' ? { ...s, status: 'idle' } : s));
    }, 3000);

    return true;
  },

  pet() {
    if (statusRestoreTimeoutId) clearTimeout(statusRestoreTimeoutId);

    devPetStore.update((s) => {
      // Petting is free, gives happy state
      let next: DevPetState = { ...s, status: 'happy' };
      // Chance of gaining 1 Coin or 5 XP
      const roll = Math.random();
      if (roll < 0.25) {
        next = addXpAndCoins(next, 5, 0);
      } else if (roll < 0.45) {
        next = addXpAndCoins(next, 0, 2);
      }
      return next;
    });

    statusRestoreTimeoutId = setTimeout(() => {
      devPetStore.update((s) => (s.status === 'happy' ? { ...s, status: 'idle' } : s));
    }, 3000);
  },

  buySkin(skinId: string, cost: number) {
    let success = false;
    devPetStore.update((s) => {
      if (s.inventory.includes(skinId)) return s;
      if (s.coins < cost) return s;
      success = true;
      return {
        ...s,
        coins: s.coins - cost,
        inventory: [...s.inventory, skinId],
        skin: skinId // auto-equip newly bought skin!
      };
    });
    return success;
  },

  equipSkin(skinId: string) {
    devPetStore.update((s) => {
      if (!s.inventory.includes(skinId)) return s;
      return { ...s, skin: skinId };
    });
  }
};
