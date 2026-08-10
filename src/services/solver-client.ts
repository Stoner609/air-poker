import type { HandSolution, SolverRequest } from "../domain/solver";

type PendingRequest = {
  resolve: (solutions: HandSolution[]) => void;
  reject: (error: Error) => void;
};

export class SolverClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();
  private sequence = 0;

  constructor() {
    this.worker = new Worker(new URL("../workers/solver.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (
      event: MessageEvent<{ id: string; solutions?: HandSolution[]; error?: string }>,
    ) => {
      const request = this.pending.get(event.data.id);
      if (!request) return;
      this.pending.delete(event.data.id);
      if (event.data.error) request.reject(new Error(event.data.error));
      else request.resolve(event.data.solutions ?? []);
    };
  }

  solve(request: SolverRequest): Promise<HandSolution[]> {
    const id = `solver-${this.sequence++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, request });
    });
  }

  dispose() {
    this.worker.terminate();
    for (const request of this.pending.values()) request.reject(new Error("Solver disposed"));
    this.pending.clear();
  }
}
