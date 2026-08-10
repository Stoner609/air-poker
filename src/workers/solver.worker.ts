/// <reference lib="webworker" />

import { solveHands, type SolverRequest } from "../domain/solver";

self.onmessage = (event: MessageEvent<{ id: string; request: SolverRequest }>) => {
  const { id, request } = event.data;
  self.postMessage({ id, solutions: solveHands(request) });
};
