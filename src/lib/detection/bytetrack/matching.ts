import { BoundingBox } from '@/types';
import { STrack } from './strack';

/**
 * Calculate IoU between two bounding boxes
 */
function calculateIoU(box1: BoundingBox, box2: BoundingBox): number {
  const x1 = Math.max(box1.x, box2.x);
  const y1 = Math.max(box1.y, box2.y);
  const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
  const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);

  if (x2 < x1 || y2 < y1) return 0;

  const intersection = (x2 - x1) * (y2 - y1);
  const area1 = box1.width * box1.height;
  const area2 = box2.width * box2.height;
  const union = area1 + area2 - intersection;

  return union > 0 ? intersection / union : 0;
}

/**
 * Compute IoU distance matrix between tracks and detections
 */
export function iouDistance(tracks: STrack[], detections: STrack[]): number[][] {
  const costMatrix: number[][] = [];
  
  for (let i = 0; i < tracks.length; i++) {
    const row: number[] = [];
    const trackBox = tracks[i].tlbr;
    
    for (let j = 0; j < detections.length; j++) {
      const detBox = detections[j].tlbr;
      const iou = calculateIoU(
        {
          x: trackBox[0],
          y: trackBox[1],
          width: trackBox[2] - trackBox[0],
          height: trackBox[3] - trackBox[1],
          confidence: 0,
          class: '',
          classId: 0
        },
        {
          x: detBox[0],
          y: detBox[1],
          width: detBox[2] - detBox[0],
          height: detBox[3] - detBox[1],
          confidence: 0,
          class: '',
          classId: 0
        }
      );
      row.push(1 - iou);
    }
    costMatrix.push(row);
  }
  
  return costMatrix;
}

/**
 * Fuse score with IoU distance
 */
export function fuseScore(costMatrix: number[][], detections: STrack[]): number[][] {
  // If no tracks (empty cost matrix), return empty matrix
  if (costMatrix.length === 0) {
    return [];
  }
  
  // If cost matrix has tracks but no detections, return original
  if (costMatrix[0].length === 0) {
    return costMatrix;
  }
  
  const fusedMatrix: number[][] = [];
  const detScores = detections.map(det => det.score);
  
  for (let i = 0; i < costMatrix.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < costMatrix[i].length; j++) {
      const iouSim = 1 - costMatrix[i][j];
      const fuseSim = iouSim * detScores[j];
      row.push(1 - fuseSim);
    }
    fusedMatrix.push(row);
  }
  
  return fusedMatrix;
}

/**
 * Linear assignment using Hungarian algorithm
 * This is a simplified version - in production, you might want to use
 * a more efficient implementation or a library
 */
export function linearAssignment(
  costMatrix: number[][],
  threshold: number,
  nDetections?: number
): [Array<[number, number]>, number[], number[]] {
  const nRows = costMatrix.length;
  const nCols = nDetections ?? (nRows > 0 ? costMatrix[0].length : 0);
  
  // Handle empty matrix cases
  if (nRows === 0 && nCols === 0) {
    return [[], [], []];
  }
  
  if (nRows === 0) {
    // No tracks but detections exist - all detections are unmatched
    return [[], [], Array.from({length: nCols}, (_, i) => i)];
  }
  
  if (nCols === 0) {
    // Tracks exist but no detections - all tracks are unmatched
    return [[], Array.from({length: nRows}, (_, i) => i), []];
  }
  const matches: Array<[number, number]> = [];
  const unmatchedRows: number[] = [];
  const unmatchedCols: number[] = [];
  
  // Simple greedy matching for now
  const usedRows = new Set<number>();
  const usedCols = new Set<number>();
  
  // Find minimum cost matches
  const candidates: Array<{cost: number, row: number, col: number}> = [];
  for (let i = 0; i < nRows; i++) {
    for (let j = 0; j < nCols; j++) {
      if (costMatrix[i][j] < threshold) {
        candidates.push({cost: costMatrix[i][j], row: i, col: j});
      }
    }
  }
  
  // Sort by cost
  candidates.sort((a, b) => a.cost - b.cost);
  
  // Greedy assignment
  for (const candidate of candidates) {
    if (!usedRows.has(candidate.row) && !usedCols.has(candidate.col)) {
      matches.push([candidate.row, candidate.col]);
      usedRows.add(candidate.row);
      usedCols.add(candidate.col);
    }
  }
  
  // Find unmatched
  for (let i = 0; i < nRows; i++) {
    if (!usedRows.has(i)) {
      unmatchedRows.push(i);
    }
  }
  
  for (let j = 0; j < nCols; j++) {
    if (!usedCols.has(j)) {
      unmatchedCols.push(j);
    }
  }
  
  return [matches, unmatchedRows, unmatchedCols];
}