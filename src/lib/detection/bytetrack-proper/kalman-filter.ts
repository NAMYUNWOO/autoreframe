/**
 * Kalman Filter implementation for object tracking
 * Optimized for 5-frame sampling intervals
 */
export class KalmanFilter {
  private _motionMat: number[][];
  private _updateMat: number[][];
  private _stdWeightPosition: number;
  private _stdWeightVelocity: number;
  
  constructor() {
    // State dimension: [cx, cy, s, h, vx, vy, vs, vh]
    // where cx,cy = center position, s = aspect ratio, h = height
    // vx,vy,vs,vh = velocities
    const ndim = 4;
    const dt = 1.0;
    
    // Create motion matrix
    this._motionMat = this.eye(2 * ndim, 2 * ndim);
    for (let i = 0; i < ndim; i++) {
      this._motionMat[i][ndim + i] = dt;
    }
    
    // Create update matrix
    this._updateMat = this.eye(ndim, 2 * ndim);
    
    // Motion and observation uncertainty weights
    // Adjusted for 5-frame intervals
    this._stdWeightPosition = 1.0 / 20.0;
    this._stdWeightVelocity = 1.0 / 160.0;
  }
  
  /**
   * Initialize a new track
   * @param measurement [cx, cy, a, h] where a is aspect ratio
   * @returns [mean, covariance]
   */
  initiate(measurement: number[]): [number[], number[][]] {
    const meanPos = measurement;
    const meanVel = [0, 0, 0, 0];
    const mean = [...meanPos, ...meanVel];
    
    const std = [
      2 * this._stdWeightPosition * measurement[3],
      2 * this._stdWeightPosition * measurement[3],
      1e-2,
      2 * this._stdWeightPosition * measurement[3],
      10 * this._stdWeightVelocity * measurement[3],
      10 * this._stdWeightVelocity * measurement[3],
      1e-5,
      10 * this._stdWeightVelocity * measurement[3]
    ];
    
    const covariance = this.diag(std.map(s => s * s));
    
    return [mean, covariance];
  }
  
  /**
   * Predict next state
   * @param mean Current mean state
   * @param covariance Current covariance
   * @returns [predicted mean, predicted covariance]
   */
  predict(mean: number[], covariance: number[][]): [number[], number[][]] {
    const std = [
      this._stdWeightPosition * mean[3],
      this._stdWeightPosition * mean[3],
      1e-2,
      this._stdWeightPosition * mean[3],
      this._stdWeightVelocity * mean[3],
      this._stdWeightVelocity * mean[3],
      1e-5,
      this._stdWeightVelocity * mean[3]
    ];
    
    const motionCov = this.diag(std.map(s => s * s));
    
    const predictedMean = this.matmul(this._motionMat, mean);
    const predictedCovariance = this.add(
      this.matmul(this.matmul(this._motionMat, covariance), this.transpose(this._motionMat)),
      motionCov
    );
    
    return [predictedMean, predictedCovariance];
  }
  
  /**
   * Update state with new measurement
   * @param mean Predicted mean
   * @param covariance Predicted covariance
   * @param measurement New measurement [cx, cy, a, h]
   * @returns [updated mean, updated covariance]
   */
  update(mean: number[], covariance: number[][], measurement: number[]): [number[], number[][]] {
    const projectedMean = this.matmul(this._updateMat, mean);
    const projectedCov = this.matmul(
      this.matmul(this._updateMat, covariance),
      this.transpose(this._updateMat)
    );
    
    const std = [
      this._stdWeightPosition * mean[3],
      this._stdWeightPosition * mean[3],
      1e-1,
      this._stdWeightPosition * mean[3]
    ];
    
    const innovationCov = this.add(
      projectedCov,
      this.diag(std.map(s => s * s))
    );
    
    const choleskyCov = this.cholesky(innovationCov);
    const kalmanGain = this.matmul(
      this.matmul(covariance, this.transpose(this._updateMat)),
      this.choleskyInverse(choleskyCov)
    );
    
    const innovation = this.subtract(measurement, projectedMean);
    const updatedMean = this.add(mean, this.matmul(kalmanGain, innovation));
    const updatedCovariance = this.subtract(
      covariance,
      this.matmul(this.matmul(kalmanGain, innovationCov), this.transpose(kalmanGain))
    );
    
    return [updatedMean, updatedCovariance];
  }
  
  // Matrix operations
  private eye(n: number, m?: number): number[][] {
    m = m || n;
    const mat = Array(n).fill(null).map(() => Array(m).fill(0));
    const minDim = Math.min(n, m);
    for (let i = 0; i < minDim; i++) {
      mat[i][i] = 1;
    }
    return mat;
  }
  
  private diag(values: number[]): number[][] {
    const n = values.length;
    const mat = Array(n).fill(null).map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      mat[i][i] = values[i];
    }
    return mat;
  }
  
  private transpose(mat: number[][]): number[][] {
    const rows = mat.length;
    const cols = mat[0].length;
    const result = Array(cols).fill(null).map(() => Array(rows).fill(0));
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        result[j][i] = mat[i][j];
      }
    }
    return result;
  }
  
  private matmul(a: number[][] | number[], b: number[][] | number[]): any {
    // Matrix-vector multiplication
    if (Array.isArray(a[0]) && !Array.isArray(b[0])) {
      const mat = a as number[][];
      const vec = b as number[];
      return mat.map(row => 
        row.reduce((sum, val, i) => sum + val * vec[i], 0)
      );
    }
    
    // Vector-matrix multiplication (treating vector as row vector)
    if (!Array.isArray(a[0]) && Array.isArray(b[0])) {
      const vec = a as number[];
      const mat = b as number[][];
      const result: number[] = [];
      for (let j = 0; j < mat[0].length; j++) {
        let sum = 0;
        for (let i = 0; i < vec.length; i++) {
          sum += vec[i] * mat[i][j];
        }
        result.push(sum);
      }
      return result;
    }
    
    // Matrix-matrix multiplication
    if (Array.isArray(a[0]) && Array.isArray(b[0])) {
      const matA = a as number[][];
      const matB = b as number[][];
      const rowsA = matA.length;
      const colsA = matA[0].length;
      const colsB = matB[0].length;
      
      const result = Array(rowsA).fill(null).map(() => Array(colsB).fill(0));
      
      for (let i = 0; i < rowsA; i++) {
        for (let j = 0; j < colsB; j++) {
          for (let k = 0; k < colsA; k++) {
            result[i][j] += matA[i][k] * matB[k][j];
          }
        }
      }
      return result;
    }
    
    throw new Error('Invalid matrix multiplication');
  }
  
  private add(a: number[][] | number[], b: number[][] | number[]): any {
    if (Array.isArray(a[0])) {
      const matA = a as number[][];
      const matB = b as number[][];
      return matA.map((row, i) => 
        row.map((val, j) => val + matB[i][j])
      );
    } else {
      const vecA = a as number[];
      const vecB = b as number[];
      return vecA.map((val, i) => val + vecB[i]);
    }
  }
  
  private subtract(a: number[] | number[][], b: number[] | number[][]): any {
    if (Array.isArray(a[0])) {
      const matA = a as number[][];
      const matB = b as number[][];
      return matA.map((row, i) => 
        row.map((val, j) => val - matB[i][j])
      );
    } else {
      const vecA = a as number[];
      const vecB = b as number[];
      return vecA.map((val, i) => val - vecB[i]);
    }
  }
  
  private cholesky(mat: number[][]): number[][] {
    const n = mat.length;
    const L = Array(n).fill(null).map(() => Array(n).fill(0));
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0;
        for (let k = 0; k < j; k++) {
          sum += L[i][k] * L[j][k];
        }
        
        if (i === j) {
          L[i][j] = Math.sqrt(Math.max(mat[i][i] - sum, 1e-6));
        } else {
          L[i][j] = (mat[i][j] - sum) / L[j][j];
        }
      }
    }
    
    return L;
  }
  
  private choleskyInverse(L: number[][]): number[][] {
    const n = L.length;
    const inv = Array(n).fill(null).map(() => Array(n).fill(0));
    
    // Forward substitution to solve L * Y = I
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          inv[i][j] = 1 / L[i][i];
        } else if (i > j) {
          let sum = 0;
          for (let k = j; k < i; k++) {
            sum += L[i][k] * inv[k][j];
          }
          inv[i][j] = -sum / L[i][i];
        }
      }
    }
    
    // inv(L^T * L) = inv(L) * inv(L)^T
    const result = this.matmul(this.transpose(inv), inv);
    return result;
  }
}