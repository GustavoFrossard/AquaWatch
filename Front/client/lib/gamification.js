/**
 * AquaWatch gamification system.
 *
 * Points: 50 per observation saved.
 *
 * Levels — based on total observations count:
 *   1 →  0-9 observations
 *   2 → 10-24
 *   3 → 25-49
 *   4 → 50-74
 *   5 → 75-99
 *   6 → 100+
 *   (continues every 25 after that)
 *
 * Badges — unlocked at observation milestones:
 *   🐟 Primeiro Peixe         → 1 observation
 *   🎣 Explorador Iniciante   → 10 observations
 *   🐠 Observador Dedicado    → 25 observations
 *   🦈 Especialista Marinho   → 50 observations
 *   🐋 Mestre dos Oceanos     → 100 observations
 */

// ── Level thresholds ──
const LEVEL_THRESHOLDS = [0, 10, 25, 50, 75, 100];
// Beyond 100, every 25 = +1 level

export function computeLevel(obsCount) {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (obsCount >= LEVEL_THRESHOLDS[i]) {
      const baseLevel = i + 1;
      if (i === LEVEL_THRESHOLDS.length - 1) {
        // Beyond the last threshold, every 25 extra = +1 level
        const extra = Math.floor((obsCount - LEVEL_THRESHOLDS[i]) / 25);
        return baseLevel + extra;
      }
      return baseLevel;
    }
  }
  return 1;
}

/** Returns { current, next, progress (0-100) } */
export function levelProgress(obsCount) {
  const level = computeLevel(obsCount);

  // Find the threshold for the current level
  let currentThreshold;
  let nextThreshold;

  if (level <= LEVEL_THRESHOLDS.length) {
    currentThreshold = LEVEL_THRESHOLDS[level - 1];
    nextThreshold = level < LEVEL_THRESHOLDS.length
      ? LEVEL_THRESHOLDS[level]
      : LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] + 25;
  } else {
    // Beyond defined thresholds
    const extraLevels = level - LEVEL_THRESHOLDS.length;
    currentThreshold = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] + (extraLevels - 1) * 25;
    // Wait — let me recalculate. Level 6 = 100, level 7 = 125, level 8 = 150 ...
    // actualLevel = LEVEL_THRESHOLDS.length + extra  where extra = Math.floor((obs - 100) / 25)
    // currentThreshold for that level = 100 + extra * 25
    // nextThreshold = currentThreshold + 25
    currentThreshold = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] + (level - LEVEL_THRESHOLDS.length) * 25;
    nextThreshold = currentThreshold + 25;
  }

  const range = nextThreshold - currentThreshold;
  const progress = range > 0 ? Math.min(100, ((obsCount - currentThreshold) / range) * 100) : 100;

  return {
    level,
    current: currentThreshold,
    next: nextThreshold,
    progress: Math.round(progress),
    remaining: Math.max(0, nextThreshold - obsCount),
  };
}

// ── Badges ──
const BADGE_DEFINITIONS = [
  { id: "first_fish",       threshold: 1,   emoji: "🐟", name: "Primeiro Peixe",         description: "Registrou sua primeira observação" },
  { id: "explorer_10",      threshold: 10,  emoji: "🎣", name: "Explorador Iniciante",    description: "Registrou 10 observações" },
  { id: "observer_25",      threshold: 25,  emoji: "🐠", name: "Observador Dedicado",     description: "Registrou 25 observações" },
  { id: "specialist_50",    threshold: 50,  emoji: "🦈", name: "Especialista Marinho",    description: "Registrou 50 observações" },
  { id: "master_100",       threshold: 100, emoji: "🐋", name: "Mestre dos Oceanos",      description: "Registrou 100 observações" },
];

/** Returns all badge definitions with an `unlocked` boolean. */
export function getAllBadges(obsCount) {
  return BADGE_DEFINITIONS.map((b) => ({
    ...b,
    unlocked: obsCount >= b.threshold,
  }));
}

/** Returns only the unlocked badge IDs (for storing in user session). */
export function getUnlockedBadgeIds(obsCount) {
  return BADGE_DEFINITIONS
    .filter((b) => obsCount >= b.threshold)
    .map((b) => b.id);
}

/** Returns badges that were just unlocked (comparing old vs new count). */
export function getNewlyUnlockedBadges(oldCount, newCount) {
  return BADGE_DEFINITIONS.filter(
    (b) => oldCount < b.threshold && newCount >= b.threshold
  );
}

/** Compute full updated user object after a new observation. */
export function updateUserAfterObservation(user, newObsCount) {
  const points = (user.points || 0) + 50;
  const level = computeLevel(newObsCount);
  const badges = getUnlockedBadgeIds(newObsCount);
  return { ...user, points, level, badges };
}

/** Level name/title for display */
export function levelTitle(level) {
  const titles = {
    1: "Iniciante",
    2: "Aprendiz",
    3: "Explorador",
    4: "Veterano",
    5: "Especialista",
    6: "Mestre",
  };
  if (level > 6) return `Lenda ${level - 6}`;
  return titles[level] || "Iniciante";
}

export { BADGE_DEFINITIONS };
