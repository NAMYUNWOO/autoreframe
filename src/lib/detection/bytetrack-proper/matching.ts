import { STrack } from './strack';
import { Detection } from './types';

/**
 * Calculate IoU between two boxes in tlbr format
 */
export function calcIoU(box1: number[], box2: number[]): number {
  const [x1_1, y1_1, x2_1, y2_1] = box1;
  const [x1_2, y1_2, x2_2, y2_2] = box2;
  
  const xi1 = Math.max(x1_1, x1_2);
  const yi1 = Math.max(y1_1, y1_2);
  const xi2 = Math.min(x2_1, x2_2);
  const yi2 = Math.min(y2_1, y2_2);
  
  const interArea = Math.max(0, xi2 - xi1) * Math.max(0, yi2 - yi1);
  
  const box1Area = (x2_1 - x1_1) * (y2_1 - y1_1);
  const box2Area = (x2_2 - x1_2) * (y2_2 - y1_2);
  
  const unionArea = box1Area + box2Area - interArea;
  
  return unionArea > 0 ? interArea / unionArea : 0;
}

/**
 * Calculate IoU distance matrix between tracks and detections
 */
export function iouDistance(tracks: STrack[], detections: Detection[]): number[][] {
  const costMatrix: number[][] = [];
  
  for (const track of tracks) {
    const costs: number[] = [];
    for (const det of detections) {
      const iou = calcIoU(track.tlbr, det.bbox);
      costs.push(1 - iou); // Convert IoU to cost
    }
    costMatrix.push(costs);
  }
  
  return costMatrix;
}

/**
 * Fuse detection scores with IoU for better matching
 */
export function fuseScore(costMatrix: number[][], detections: Detection[]): number[][] {
  const iouSim = costMatrix.map(row => row.map(cost => 1 - cost));
  const detScores = detections.map(det => det.score);
  
  const fusedMatrix: number[][] = [];
  for (let i = 0; i < iouSim.length; i++) {
    const fusedRow: number[] = [];
    for (let j = 0; j < iouSim[i].length; j++) {
      const fusedSim = iouSim[i][j] * detScores[j];
      fusedRow.push(1 - fusedSim); // Convert back to cost
    }
    fusedMatrix.push(fusedRow);
  }
  
  return fusedMatrix;
}

/**
 * Hungarian algorithm implementation for linear assignment
 */
export function linearAssignment(costMatrix: number[][], threshold: number = 1.0): [number[][], number[], number[]] {
  if (costMatrix.length === 0 || costMatrix[0].length === 0) {
    return [[], Array.from({length: costMatrix.length}, (_, i) => i), Array.from({length: costMatrix[0]?.length || 0}, (_, i) => i)];
  }
  
  const nRows = costMatrix.length;
  const nCols = costMatrix[0].length;
  const maxCost = 1e9;
  
  // Pad cost matrix to make it square
  const size = Math.max(nRows, nCols);
  const paddedCost: number[][] = [];
  
  for (let i = 0; i < size; i++) {
    const row: number[] = [];
    for (let j = 0; j < size; j++) {
      if (i < nRows && j < nCols) {
        row.push(costMatrix[i][j]);
      } else {
        row.push(maxCost);
      }
    }
    paddedCost.push(row);
  }
  
  // Hungarian algorithm
  const assignment = hungarianAlgorithm(paddedCost);
  
  // Filter valid assignments
  const matches: number[][] = [];
  const unmatchedA: number[] = [];
  const unmatchedB: number[] = [];
  
  const assignedB = new Set<number>();
  
  for (let i = 0; i < nRows; i++) {
    const j = assignment[i];
    if (j < nCols && costMatrix[i][j] < threshold) {
      matches.push([i, j]);
      assignedB.add(j);
    } else {
      unmatchedA.push(i);
    }
  }
  
  for (let j = 0; j < nCols; j++) {
    if (!assignedB.has(j)) {
      unmatchedB.push(j);
    }
  }
  
  return [matches, unmatchedA, unmatchedB];
}

/**
 * Simplified Hungarian algorithm
 */
function hungarianAlgorithm(costMatrix: number[][]): number[] {
  const n = costMatrix.length;
  const INF = 1e9;
  
  // Initialize
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  
  for (let i = 1; i <= n; ++i) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(INF);
    const used = new Array(n + 1).fill(false);
    
    do {
      used[j0] = true;
      let i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      
      for (let j = 1; j <= n; ++j) {
        if (!used[j]) {
          const cur = costMatrix[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }
      
      for (let j = 0; j <= n; ++j) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      
      j0 = j1;
    } while (p[j0] !== 0);
    
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  
  // Extract assignment
  const assignment = new Array(n).fill(-1);
  for (let j = 1; j <= n; ++j) {
    if (p[j] !== 0) {
      assignment[p[j] - 1] = j - 1;
    }
  }
  
  return assignment;
}