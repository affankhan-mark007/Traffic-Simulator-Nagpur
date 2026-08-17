/**
 * liveTraffic.js
 * Fetches real-world congestion via TomTom's Traffic Flow API and maps
 * it onto the same 0-100 load scale the synthetic congestionModel.js
 * uses, so it can be swapped in as a drop-in replacement per hotspot.
 *
 * Polled on a real-world interval from main.js — never called once per
 * simulation tick, since that would blow through API rate limits in
 * seconds even at 1x sim speed.
 */

/**
 * Fetches live load for a single intersection.
 * @returns {Promise<number>} 0-100 load, derived from how far below
 *   free-flow speed the current speed is.
 */
async function fetchLiveLoad(intersection, apiKey) {
  const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${intersection.lat},${intersection.lng}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TomTom ${res.status} for ${intersection.id}`);

  const { flowSegmentData } = await res.json();
  const { currentSpeed, freeFlowSpeed } = flowSegmentData;

  if (!freeFlowSpeed || freeFlowSpeed <= 0) {
    throw new Error(`No freeFlowSpeed for ${intersection.id}`);
  }

  return Math.max(0, Math.min(100, (1 - currentSpeed / freeFlowSpeed) * 100));
}

/**
 * Fetches live load for every intersection. Uses allSettled so one
 * failed point (dead zone, rate limit) doesn't take down the rest —
 * failed ids are simply absent from the returned loads object, and the
 * caller in main.js falls back to the synthetic model for those.
 *
 * @returns {Promise<{loads: Object, failedIds: string[]}>}
 */
async function fetchAllLiveLoads(intersections, apiKey) {
  const loads = {};
  const failedIds = [];

  const results = await Promise.allSettled(
    intersections.map((i) => fetchLiveLoad(i, apiKey).then((load) => ({ id: i.id, load })))
  );

  results.forEach((result, idx) => {
    if (result.status === "fulfilled") {
      loads[result.value.id] = result.value.load;
    } else {
      failedIds.push(intersections[idx].id);
      console.warn("Live traffic fetch failed:", intersections[idx].id, result.reason);
    }
  });

  return { loads, failedIds };
}

/**
 * LiveTraffic
 * The stateful wrapper main.js actually talks to: owns the on/off
 * flag, the poll timer, and the latest per-hotspot loads, and drives
 * everything above through them. Kept as its own IIFE (same pattern
 * as ManualSurge) so main.js can treat it as a simple singleton.
 */
const LiveTraffic = (() => {
  let enabled = false;
  let intervalId = null;
  let latestLoads = {}; // id -> 0-100 load from the most recent successful poll
  let onStatusChange = () => {};

  function setStatus(text) {
    onStatusChange(text);
  }

  /** Registers the status callback (main.js wires this to a UI label). */
  function init(statusCallback) {
    onStatusChange = typeof statusCallback === "function" ? statusCallback : () => {};
    setStatus("Off");
  }

  /** Fetches one round of live loads and updates state + status text. */
  async function poll(intersections) {
    setStatus("Fetching…");
    try {
      const { loads, failedIds } = await fetchAllLiveLoads(intersections, CONFIG.liveTraffic.apiKey);
      latestLoads = loads;
      const gotCount = Object.keys(loads).length;

      if (gotCount === 0) {
        setStatus("No data");
      } else if (failedIds.length > 0) {
        setStatus(`Live (${failedIds.length} failed)`);
      } else {
        setStatus("Live");
      }
    } catch (err) {
      console.error("Live traffic poll failed:", err);
      setStatus("Error");
    }
  }

  /** Turns the feed on: immediate poll, then repeats every pollIntervalMs. */
  function enable(intersections) {
    enabled = true;
    poll(intersections); // don't wait for the first interval tick

    if (intervalId === null) {
      intervalId = setInterval(() => poll(intersections), CONFIG.liveTraffic.pollIntervalMs);
    }
  }

  /** Turns the feed off and drops any cached loads, so render() falls back to synthetic. */
  function disable() {
    enabled = false;
    latestLoads = {};
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    setStatus("Off");
  }

  function isEnabled() {
    return enabled;
  }

  /** Returns the last polled load for an id, or null if none yet / feed is off. */
  function getLoad(id) {
    return enabled && latestLoads[id] !== undefined ? latestLoads[id] : null;
  }

  return { init, enable, disable, isEnabled, getLoad };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = { fetchLiveLoad, fetchAllLiveLoads, LiveTraffic };
}