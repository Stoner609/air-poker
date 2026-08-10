import { solveHands, type HandSolution, type SolverRequest } from "../domain/solver";
import { SolverClient } from "./solver-client";

let client: SolverClient | undefined;

export function solveInBackground(request: SolverRequest): Promise<HandSolution[]> {
  if (typeof Worker === "undefined") return Promise.resolve(solveHands(request));
  client ??= new SolverClient();
  return client.solve(request);
}
