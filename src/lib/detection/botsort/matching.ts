import { STrack } from './strack';
import { Detection } from './types';

/**
 * Compute IoU distance between tracks and detections
 * Enhanced with center distance for better matching with 5-frame sampling
 */
export function iouDistance(atracks: STrack[], btracks: Detection[]): number[][] {
  const atlbrs = atracks.map(t => t.tlbr);
  const btlbrs = btracks.map(d => d.bbox);
  
  // Calculate IoU distances
  const iouDists: number[][] = [];
  for (const atlbr of atlbrs) {
    const row: number[] = [];
    for (const btlbr of btlbrs) {
      const iou = calculateIoU(atlbr, btlbr);
      row.push(1 - iou);
    }
    iouDists.push(row);
  }
  
  // Calculate center distances
  const centerDists = calcCenterDistances(atlbrs, btlbrs);
  
  // Combine IoU and center distance (like ByteTracker does)
  const dists: number[][] = [];
  for (let i = 0; i < iouDists.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < iouDists[i].length; j++) {
      // Use 50% IoU and 50% center distance for 5-frame sampling
      const combinedDist = 0.5 * iouDists[i][j] + 0.5 * centerDists[i][j];
      row.push(combinedDist);
    }
    dists.push(row);
  }
  
  return dists;
}

/**
 * Compute embedding distance between tracks and detections
 */
export function embeddingDistance(tracks: STrack[], detections: Detection[]): number[][] {
  const dists: number[][] = [];
  
  for (const track of tracks) {
    const row: number[] = [];
    
    for (const det of detections) {
      if (track.smoothFeatures.length > 0 && det.features && det.features.length > 0) {
        // Cosine distance between features
        const dist = cosineDistance(track.smoothFeatures, det.features);
        row.push(dist);
      } else {
        // No features available, use max distance
        row.push(2.0);
      }
    }
    
    dists.push(row);
  }
  
  return dists;
}

/**
 * Fuse IoU and embedding distances
 */
export function fuseDistance(ious: number[][], embs: number[][], alpha: number = 0.5): number[][] {
  const rows = ious.length;
  const cols = ious[0].length;
  const fused: number[][] = [];
  
  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      // Only fuse if both distances are valid
      if (ious[i][j] < 0.5 && embs[i][j] < 2.0) {
        row.push(alpha * ious[i][j] + (1 - alpha) * embs[i][j]);
      } else {
        row.push(Math.min(ious[i][j], embs[i][j]));
      }
    }
    fused.push(row);
  }
  
  return fused;
}

/**
 * Fuse score with distance for better matching
 */
export function fuseScore(distances: number[][], detections: Detection[]): number[][] {
  const fusedDists: number[][] = [];
  
  for (let i = 0; i < distances.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < distances[i].length; j++) {
      // Reduce distance for high confidence detections
      const scoreFactor = 1 - detections[j].score * 0.2;
      row.push(distances[i][j] * scoreFactor);
    }
    fusedDists.push(row);
  }
  
  return fusedDists;
}

/**
 * Calculate IoU between two bounding boxes
 */
function calculateIoU(box1: number[], box2: number[]): number {
  const [x1a, y1a, x2a, y2a] = box1;
  const [x1b, y1b, x2b, y2b] = box2;
  
  const xi1 = Math.max(x1a, x1b);
  const yi1 = Math.max(y1a, y1b);
  const xi2 = Math.min(x2a, x2b);
  const yi2 = Math.min(y2a, y2b);
  
  const interArea = Math.max(0, xi2 - xi1) * Math.max(0, yi2 - yi1);
  const box1Area = (x2a - x1a) * (y2a - y1a);
  const box2Area = (x2b - x1b) * (y2b - y1b);
  const unionArea = box1Area + box2Area - interArea;
  
  return unionArea > 0 ? interArea / unionArea : 0;
}

/**
 * Calculate normalized center distances between two sets of bounding boxes
 * (Adapted from ByteTracker for 5-frame sampling)
 */
function calcCenterDistances(tlbrs1: number[][], tlbrs2: number[][]): number[][] {
  const distances: number[][] = [];
  
  // Get image dimensions for normalization
  let maxX = 0, maxY = 0;
  for (const tlbr of [...tlbrs1, ...tlbrs2]) {
    maxX = Math.max(maxX, tlbr[2]);
    maxY = Math.max(maxY, tlbr[3]);
  }
  const diagLength = Math.sqrt(maxX * maxX + maxY * maxY) || 1;
  
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
      
      // Normalize by diagonal length
      const normalizedDistance = Math.min(distance / diagLength, 1.0);
      row.push(normalizedDistance);
    }
    
    distances.push(row);
  }
  
  return distances;
}

/**
 * Calculate cosine distance between two feature vectors
 */
function cosineDistance(feat1: number[], feat2: number[]): number {
  if (feat1.length !== feat2.length) return 2.0;
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < feat1.length; i++) {
    dotProduct += feat1[i] * feat2[i];
    norm1 += feat1[i] * feat1[i];
    norm2 += feat2[i] * feat2[i];
  }
  
  norm1 = Math.sqrt(norm1);
  norm2 = Math.sqrt(norm2);
  
  if (norm1 === 0 || norm2 === 0) return 2.0;
  
  const similarity = dotProduct / (norm1 * norm2);
  return 1 - similarity;
}

/**
 * Linear assignment using greedy algorithm
 */
export function linearAssignment(
  distMatrix: number[][],
  threshold: number
): [Array<[number, number]>, number[], number[]] {
  if (distMatrix.length === 0 || distMatrix[0].length === 0) {
    return [[], [], []];
  }
  
  const rows = distMatrix.length;
  const cols = distMatrix[0].length;
  
  // Flatten distance matrix with indices
  const costs: Array<{ row: number; col: number; cost: number }> = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (distMatrix[i][j] <= threshold) {
        costs.push({ row: i, col: j, cost: distMatrix[i][j] });
      }
    }
  }
  
  // Sort by cost
  costs.sort((a, b) => a.cost - b.cost);
  
  // Greedy assignment
  const matches: Array<[number, number]> = [];
  const matchedRows = new Set<number>();
  const matchedCols = new Set<number>();
  
  for (const { row, col } of costs) {
    if (!matchedRows.has(row) && !matchedCols.has(col)) {
      matches.push([row, col]);
      matchedRows.add(row);
      matchedCols.add(col);
    }
  }
  
  // Find unmatched indices
  const unmatchedRows: number[] = [];
  const unmatchedCols: number[] = [];
  
  for (let i = 0; i < rows; i++) {
    if (!matchedRows.has(i)) {
      unmatchedRows.push(i);
    }
  }
  
  for (let j = 0; j < cols; j++) {
    if (!matchedCols.has(j)) {
      unmatchedCols.push(j);
    }
  }
  
  return [matches, unmatchedRows, unmatchedCols];
}

/**
 * Gate cost matrix by thresholding large distances
 */
export function gateCostMatrix(
  costMatrix: number[][],
  tracks: STrack[],
  detections: Detection[],
  gateThreshold: number = 4.0
): number[][] {
  const gatedCosts: number[][] = [];
  
  for (let i = 0; i < costMatrix.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < costMatrix[i].length; j++) {
      // Gate by spatial proximity
      const track = tracks[i];
      const det = detections[j];
      
      const [tx, ty, tw, th] = track.tlwh;
      const [dx, dy, dw, dh] = STrack.tlbrToTlwh(det.bbox);
      
      const centerDist = Math.sqrt(
        Math.pow((tx + tw/2) - (dx + dw/2), 2) +
        Math.pow((ty + th/2) - (dy + dh/2), 2)
      );
      
      const maxDim = Math.max(tw, th, dw, dh);
      const normalizedDist = centerDist / maxDim;
      
      if (normalizedDist > gateThreshold) {
        row.push(1e6);  // Infinite cost
      } else {
        row.push(costMatrix[i][j]);
      }
    }
    gatedCosts.push(row);
  }
  
  return gatedCosts;
}