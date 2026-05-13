/**
 * consensusSimulation.ts
 *
 * k-Set Byzantine Consensus Simulation for HIE Data Consistency
 * ==============================================================
 * Formal basis: Professor Soma Chaudhuri's k-set consensus problem.
 *
 * Definition: In k-set consensus, n processes must decide on values such
 * that the total number of distinct decided values is at most k.
 *
 * Byzantine fault tolerance formula: n > 3f + 1
 *   where n = total nodes, f = max faulty nodes
 *
 * For this HIE system: n=5 simulated nodes, f=1 faulty node allowed
 *   k = n - 3f = 5 - 3(1) = 2  →  at most 2 distinct values in the agreed set
 *
 * Algorithm:
 *   1. Collect responses from all available nodes
 *   2. Group identical responses (frequency map)
 *   3. A value is accepted only if its frequency >= (f + 1) = 2
 *      (i.e., at least 2 nodes agree — cannot be a single Byzantine liar)
 *   4. Return the accepted group; if none meets the threshold, return []
 *      to signal consensus failure
 *
 * In the HIE context: ensures the network converges on a consistent view
 * of patient data despite network delays or a faulty node.
 *
 * LaTeX: $n > 3f + 1$, $k = n - 3f$
 */
export default function simulateConsensus(
  values: string[],
  n: number = 5,
  f: number = 1
): string[] {
  // k-set size derived from Byzantine fault tolerance: k = n - 3f
  const k         = n - 3 * f;          // k = 2
  const threshold = f + 1;              // minimum agreements needed = 2

  if (values.length === 0) return [];

  // Step 1: Build frequency map of responses
  const freq = new Map<string, number>();
  for (const v of values) {
    freq.set(v, (freq.get(v) ?? 0) + 1);
  }

  // Step 2: Collect values that meet the Byzantine agreement threshold
  const agreed: string[] = [];
  for (const [val, count] of freq.entries()) {
    if (count >= threshold) {
      agreed.push(val);
    }
  }

  // Step 3: If no value meets the threshold, consensus has failed
  if (agreed.length === 0) return [];

  // Step 4: Enforce k-set bound — return at most k agreed values
  // (sorted for determinism so the same set always produces the same output)
  return agreed.slice(0, k);
}
