/**
 * rerouting.js
 * Dynamic rerouting mitigation: shifts a fraction of the excess load
 * on overloaded intersections onto nearby intersections that still
 * have spare capacity. Pure function of (intersections, rawLoads,
 * config) -> new loads + the pairs that moved, so main.js can render
 * both the map and the side-panel stats from the same result.
 */

/** Great-circle distance between two {lat,lng} points, in kilometers. */
function haversineDistanceKm(a, b) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Redistributes load from overloaded intersections to nearby ones with
 * spare capacity.
 *
 * @param {Array} intersections - full intersection list (id, name, lat, lng, ...)
 * @param {Object} rawLoads - id -> 0-100 load, before any redistribution
 * @param {Object} opts - CONFIG.rerouting (overloadThreshold,
 *   spareCapacityThreshold, maxNeighborDistanceKm,
 *   redistributionFraction, maxRecipients)
 * @returns {{effectiveLoads: Object, reroutedPairs: Array<{from, to, amount}>}}
 *   `from`/`to` are the full intersection objects (so callers can read
 *   .id/.name/.lat/.lng directly) and `amount` is the load-points moved.
 */
function applyRerouting(intersections, rawLoads, opts) {
  const {
    overloadThreshold,
    spareCapacityThreshold,
    maxNeighborDistanceKm,
    redistributionFraction,
    maxRecipients,
  } = opts;

  const effectiveLoads = { ...rawLoads };
  const reroutedPairs = [];

  // Most overloaded first, so the worst junctions get first pick of any
  // nearby spare capacity within this tick.
  const overloaded = intersections
    .filter((i) => rawLoads[i.id] > overloadThreshold)
    .sort((a, b) => rawLoads[b.id] - rawLoads[a.id]);

  overloaded.forEach((source) => {
    const excess = rawLoads[source.id] - overloadThreshold;
    const totalToShift = excess * redistributionFraction;
    if (totalToShift <= 0) return;

    // Nearby candidates that currently have spare capacity, closest first.
    const neighbors = intersections
      .filter((candidate) => candidate.id !== source.id)
      .map((candidate) => ({
        candidate,
        distanceKm: haversineDistanceKm(source, candidate),
      }))
      .filter(
        ({ candidate, distanceKm }) =>
          distanceKm <= maxNeighborDistanceKm &&
          effectiveLoads[candidate.id] < spareCapacityThreshold
      )
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, maxRecipients);

    if (neighbors.length === 0) return;

    const sharePerNeighbor = totalToShift / neighbors.length;

    neighbors.forEach(({ candidate }) => {
      // Don't push a recipient past the point it's still "spare".
      const headroom = spareCapacityThreshold - effectiveLoads[candidate.id];
      const amount = Math.max(0, Math.min(sharePerNeighbor, headroom));
      if (amount <= 0) return;

      effectiveLoads[source.id] -= amount;
      effectiveLoads[candidate.id] += amount;

      reroutedPairs.push({ from: source, to: candidate, amount });
    });
  });

  intersections.forEach((i) => {
    effectiveLoads[i.id] = Math.max(0, Math.min(100, effectiveLoads[i.id]));
  });

  return { effectiveLoads, reroutedPairs };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { applyRerouting, haversineDistanceKm };
}
