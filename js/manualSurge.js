/**
 * manualSurge.js
 * Lets you manually inject extra "demand" at any one hotspot to see
 * how dynamic rerouting reacts in real time — e.g. simulate a stalled
 * vehicle, an accident, or an event crowd suddenly loading up one
 * junction, then watch load spill over to nearby intersections.
 *
 * Surges are additive on top of whatever the congestion model (and,
 * if enabled, the live traffic feed) already computed for that tick.
 * They persist until cleared — this is a manual "what if" control,
 * not a timed effect — so it's easy to demo and reproduce on cue.
 */
const ManualSurge = (() => {
  const boosts = {}; // id -> extra load (0-100)

  function setBoost(id, amount) {
    const clamped = Math.max(0, Math.min(100, Math.round(amount)));
    if (clamped <= 0) {
      delete boosts[id];
    } else {
      boosts[id] = clamped;
    }
  }

  function clearBoost(id) {
    delete boosts[id];
  }

  function clearAll() {
    Object.keys(boosts).forEach((id) => delete boosts[id]);
  }

  /** Returns a shallow copy so callers can't mutate internal state directly. */
  function getActive() {
    return { ...boosts };
  }

  function hasAny() {
    return Object.keys(boosts).length > 0;
  }

  /** Returns a new loads object with every active surge added in, capped at 100. */
  function apply(loads) {
    if (!hasAny()) return loads;
    const result = { ...loads };
    Object.entries(boosts).forEach(([id, amount]) => {
      if (result[id] !== undefined) {
        result[id] = Math.min(100, result[id] + amount);
      }
    });
    return result;
  }

  return { setBoost, clearBoost, clearAll, getActive, hasAny, apply };
})();