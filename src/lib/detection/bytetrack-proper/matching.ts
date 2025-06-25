import { STrack } from './strack';
import { Detection } from './types';
import { detectionConfig } from '@/config/detection';

/**
 * Calculate IoU distance matrix between tracks and detections
 * Now includes center distance to handle size changes better
 */
export function iouDistance(
  atracks: STrack[], 
  btracks: Detection[] | STrack[]
): number[][] {
  if (atracks.length === 0 || btracks.length === 0) {
    return [];
  }
  
  const atlbrs = atracks.map(t => t.tlbr);
  const btlbrs: number[][] = [];
  
  // Convert to tlbr format
  for (const b of btracks) {
    if ('bbox' in b) {
      // Detection format - already in tlbr
      btlbrs.push(b.bbox);
    } else {
      // STrack format
      btlbrs.push((b as STrack).tlbr);
    }
  }
  
  // Calculate IoU matrix
  const ious = calcIoUs(atlbrs, btlbrs);
  
  // Calculate center distances
  const centerDists = calcCenterDistances(atlbrs, btlbrs);
  
  // Combine IoU and center distance
  // When box size changes dramatically, IoU can be low but center distance remains reliable
  const dists: number[][] = [];
  for (let i = 0; i < ious.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < ious[i].length; j++) {
      const iouDist = 1 - ious[i][j];
      const centerDist = centerDists[i][j];
      
      // Weighted combination: IoU is still important but center distance helps
      // when box size changes dramatically
      const centerWeight = detectionConfig.byteTracker.centerDistanceWeight;
      const iouWeight = 1 - centerWeight;
      const combinedDist = iouWeight * iouDist + centerWeight * centerDist;
      
      row.push(combinedDist);
    }
    dists.push(row);
  }
  
  return dists;
}

/**
 * Calculate IoU between two sets of bounding boxes
 */
function calcIoUs(tlbrs1: number[][], tlbrs2: number[][]): number[][] {
  const ious: number[][] = [];
  
  for (const tlbr1 of tlbrs1) {
    const row: number[] = [];
    const [x1a, y1a, x2a, y2a] = tlbr1;
    const areaA = (x2a - x1a) * (y2a - y1a);
    
    for (const tlbr2 of tlbrs2) {
      const [x1b, y1b, x2b, y2b] = tlbr2;
      const areaB = (x2b - x1b) * (y2b - y1b);
      
      // Calculate intersection
      const x1i = Math.max(x1a, x1b);
      const y1i = Math.max(y1a, y1b);
      const x2i = Math.min(x2a, x2b);
      const y2i = Math.min(y2a, y2b);
      
      const intersection = Math.max(0, x2i - x1i) * Math.max(0, y2i - y1i);
      const union = areaA + areaB - intersection;
      
      const iou = union > 0 ? intersection / union : 0;
      row.push(iou);
    }
    
    ious.push(row);
  }
  
  return ious;
}

/**
 * Calculate normalized center distances between two sets of bounding boxes
 */
function calcCenterDistances(tlbrs1: number[][], tlbrs2: number[][]): number[][] {
  const distances: number[][] = [];
  
  // Get image dimensions for normalization (approximate from box coordinates)
  let maxX = 0, maxY = 0;
  for (const tlbr of [...tlbrs1, ...tlbrs2]) {
    maxX = Math.max(maxX, tlbr[2]);
    maxY = Math.max(maxY, tlbr[3]);
  }
  const diagLength = Math.sqrt(maxX * maxX + maxY * maxY);
  
  for (const tlbr1 of tlbrs1) {
    const row: number[] = [];
    const [x1a, y1a, x2a, y2a] = tlbr1;
    const centerX1 = (x1a + x2a) / 2;
    const centerY1 = (y1a + y2a) / 2;
    
    for (const tlbr2 of tlbrs2) {
      const [x1b, y1b, x2b, y2b] = tlbr2;
      const centerX2 = (x1b + x2b) / 2;
      const centerY2 = (y1b + y2b) / 2;
      
      // Euclidean distance between centers
      const distance = Math.sqrt(
        Math.pow(centerX1 - centerX2, 2) + 
        Math.pow(centerY1 - centerY2, 2)
      );
      
      // Normalize by diagonal length to get value between 0 and 1
      const normalizedDistance = Math.min(distance / diagLength, 1.0);
      row.push(normalizedDistance);
    }
    
    distances.push(row);
  }
  
  return distances;
}

/**
 * Simple linear assignment using greedy matching
 * For production, consider using Hungarian algorithm
 */
export function linearAssignment(
  costMatrix: number[][], 
  thresh: number
): [Array<[number, number]>, number[], number[]] {
  if (costMatrix.length === 0 || costMatrix[0].length === 0) {
    const unmatchedA = Array.from({ length: costMatrix.length }, (_, i) => i);
    const unmatchedB = Array.from({ length: costMatrix[0]?.length || 0 }, (_, i) => i);
    return [[], unmatchedA, unmatchedB];
  }
  
  const nRows = costMatrix.length;
  const nCols = costMatrix[0].length;
  const matches: Array<[number, number]> = [];
  const matchedRows = new Set<number>();
  const matchedCols = new Set<number>();
  
  // Find all valid matches below threshold
  const validMatches: Array<[number, number, number]> = [];
  for (let i = 0; i < nRows; i++) {
    for (let j = 0; j < nCols; j++) {
      if (costMatrix[i][j] <= thresh) {
        validMatches.push([i, j, costMatrix[i][j]]);
      }
    }
  }
  
  // Sort by cost (ascending)
  validMatches.sort((a, b) => a[2] - b[2]);
  
  // Greedy matching
  for (const [i, j, cost] of validMatches) {
    if (!matchedRows.has(i) && !matchedCols.has(j)) {
      matches.push([i, j]);
      matchedRows.add(i);
      matchedCols.add(j);
    }
  }
  
  // Find unmatched indices
  const unmatchedA: number[] = [];
  const unmatchedB: number[] = [];
  
  for (let i = 0; i < nRows; i++) {
    if (!matchedRows.has(i)) {
      unmatchedA.push(i);
    }
  }
  
  for (let j = 0; j < nCols; j++) {
    if (!matchedCols.has(j)) {
      unmatchedB.push(j);
    }
  }
  
  return [matches, unmatchedA, unmatchedB];
}