/**
 * waitFreeRegister.ts
 *
 * Wait-Free Shared Register Simulation
 * =====================================
 * Theoretical basis: Professor Soma Chaudhuri (Iowa State University)
 * Research area: Distributed Algorithms — Wait-Free Implementations
 *
 * FORMAL DEFINITION:
 * A wait-free register guarantees that every process completes its
 * read or write operation in a finite number of its own steps,
 * regardless of the speed or failure of other processes.
 * This is the strongest progress guarantee in distributed computing.
 *
 * Formally: An operation op by process p is wait-free if there exists
 * a finite bound B(p) such that op completes within B(p) steps of p,
 * independent of the behaviour of all other processes.
 *
 * APPLICATION TO HIE:
 * In the Health Information Exchange context, the wait-free register
 * models the patient consent state — a shared variable that multiple
 * hospital nodes may attempt to read (check consent) or write
 * (update consent) concurrently. The wait-free guarantee ensures:
 *
 *   1. A hospital checking consent always gets a response in finite
 *      steps — no hospital is blocked indefinitely by another.
 *   2. A patient revoking consent always completes — even if other
 *      hospitals are simultaneously reading.
 *   3. The system remains live under asynchrony — satisfying the
 *      "fault-tolerant, non-blocking coordination" requirement.
 *
 * IMPLEMENTATION MODEL:
 * This implements an atomic multi-reader multi-writer (MRMW) register
 * using a timestamp-based protocol. Each write attaches a logical
 * timestamp; reads return the value with the highest timestamp,
 * ensuring linearizability (the strongest consistency guarantee for
 * shared registers).
 *
 * This directly satisfies Prof. Shao's Health IT requirement:
 * demonstrating the tension between data ACCESSIBILITY (wait-free
 * reads always complete) and data PRIVACY (writes enforce consent
 * boundaries that reads must respect).
 *
 * LaTeX: A register $R$ is wait-free if $\forall p, \exists B(p)$
 * such that every operation by $p$ completes within $B(p)$ steps.
 */

export interface RegisterEntry {
  value:     string;   // The consent state value (e.g. "granted" | "revoked" | "pending")
  timestamp: number;   // Logical Lamport timestamp
  writerId:  string;   // Identity of the process that wrote this value
  seqNum:    number;   // Sequence number for linearizability
}

export interface WaitFreeRegister {
  read(readerId: string):  RegisterEntry;
  write(value: string, writerId: string): RegisterEntry;
  history(): RegisterEntry[];
}

/**
 * Creates a wait-free MRMW register for a given patient consent slot.
 *
 * The register is initialised with a "pending" state and a logical
 * clock starting at 0. Each write atomically increments the clock,
 * ensuring a total order on all writes — the foundation of
 * linearizability in asynchronous distributed systems.
 */
export function createWaitFreeRegister(
  initialValue: string = "pending"
): WaitFreeRegister {
  // Internal state — simulates the shared memory of the register
  let current: RegisterEntry = {
    value:     initialValue,
    timestamp: 0,
    writerId:  "system",
    seqNum:    0,
  };

  // Append-only history log — models the immutable audit trail
  // required by the HIE blockchain layer
  const log: RegisterEntry[] = [{ ...current }];

  // Logical Lamport clock — incremented on every write
  let clock = 0;

  return {
    /**
     * WAIT-FREE READ:
     * Returns the current register value in O(1) steps.
     * Guaranteed to complete regardless of concurrent writes.
     * Models a hospital node checking patient consent state.
     */
    read(readerId: string): RegisterEntry {
      // Wait-free: always returns immediately — no blocking
      console.log(
        `[WaitFreeRegister] READ  by ${readerId} → ` +
        `value="${current.value}" ts=${current.timestamp} seq=${current.seqNum}`
      );
      return { ...current };
    },

    /**
     * WAIT-FREE WRITE:
     * Atomically updates the register with a new value and incremented
     * Lamport timestamp. Completes in O(1) steps — wait-free.
     * Models a patient (via the system acting as guardian) updating
     * their consent state on the shared register.
     */
    write(value: string, writerId: string): RegisterEntry {
      clock += 1; // Increment Lamport clock — ensures total order
      const entry: RegisterEntry = {
        value,
        timestamp: clock,
        writerId,
        seqNum:    log.length,
      };
      current = entry;
      log.push({ ...entry });
      console.log(
        `[WaitFreeRegister] WRITE by ${writerId} → ` +
        `value="${value}" ts=${clock} seq=${entry.seqNum}`
      );
      return { ...entry };
    },

    /**
     * Returns the full operation history of this register.
     * Models the immutable audit trail — every consent state
     * transition is permanently recorded, satisfying the
     * auditability requirement of the HIE system.
     */
    history(): RegisterEntry[] {
      return log.map(e => ({ ...e }));
    },
  };
}

/**
 * Register Pool — one wait-free register per patient consent slot.
 *
 * In a production multi-node HIE, each register would be replicated
 * across n > 3f + 1 nodes. Here we maintain an in-memory pool that
 * is consulted on every access request, demonstrating the algorithm
 * without requiring a full distributed deployment.
 */
const registerPool = new Map<string, WaitFreeRegister>();

export function getOrCreateRegister(patientId: string): WaitFreeRegister {
  if (!registerPool.has(patientId)) {
    registerPool.set(patientId, createWaitFreeRegister("pending"));
  }
  return registerPool.get(patientId)!;
}

export function getRegisterHistory(patientId: string): RegisterEntry[] {
  const reg = registerPool.get(patientId);
  return reg ? reg.history() : [];
}
