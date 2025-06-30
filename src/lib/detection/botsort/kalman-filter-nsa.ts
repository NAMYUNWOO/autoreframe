export class KalmanFilterNSA {
  private readonly ndim = 4;
  private readonly dt = 1.0;
  private readonly F: number[][];
  private readonly Q: number[][];
  private readonly H: number[][];
  private readonly R: number[][];
  private _motion_mat: number[][];
  private _update_mat: number[][];
  private _std_weight_position = 1.0 / 10;  // Increased for 5-frame sampling
  private _std_weight_velocity = 1.0 / 40;  // Increased for 5-frame sampling
  
  constructor() {
    // State transition matrix
    this.F = [
      [1, 0, 0, 0, 1, 0, 0, 0],
      [0, 1, 0, 0, 0, 1, 0, 0],
      [0, 0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 1, 0, 0, 0, 1],
      [0, 0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 0, 0, 1]
    ];
    
    // Process noise covariance
    this.Q = this.eye(8, 0.01);
    
    // Measurement matrix
    this.H = [
      [1, 0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0, 0]
    ];
    
    // Measurement noise covariance
    this.R = this.eye(4, 1.0);
    
    this._motion_mat = this.F;
    this._update_mat = this.H;
  }
  
  /**
   * Initialize track from measurement
   * @param measurement [x, y, w, h] bounding box
   * @returns Initial state mean and covariance
   */
  initiate(measurement: number[]): [number[], number[][]] {
    const mean = [...measurement, 0, 0, 0, 0];
    const std = [
      2 * this._std_weight_position * measurement[2],  // x
      2 * this._std_weight_position * measurement[3],  // y
      2 * this._std_weight_position * measurement[2],  // w
      2 * this._std_weight_position * measurement[3],  // h
      10 * this._std_weight_velocity * measurement[2], // vx
      10 * this._std_weight_velocity * measurement[3], // vy
      10 * this._std_weight_velocity * measurement[2], // vw
      10 * this._std_weight_velocity * measurement[3]  // vh
    ];
    
    const covariance = this.diag(std.map(s => s * s));
    return [mean, covariance];
  }
  
  /**
   * Predict next state
   * @param mean Current state mean
   * @param covariance Current state covariance
   * @returns Predicted state mean and covariance
   */
  predict(mean: number[], covariance: number[][]): [number[], number[][]] {
    // Process noise with NSA (Noise Scale Adaptive)
    const std = [
      this._std_weight_position * mean[2],   // x
      this._std_weight_position * mean[3],   // y
      this._std_weight_position * mean[2],   // w
      this._std_weight_position * mean[3],   // h
      this._std_weight_velocity * mean[2],   // vx
      this._std_weight_velocity * mean[3],   // vy
      this._std_weight_velocity * mean[2],   // vw
      this._std_weight_velocity * mean[3]    // vh
    ];
    
    const motionCov = this.diag(std.map(s => s * s));
    
    // State prediction
    const predictedMean = this.matVecMul(this._motion_mat, mean);
    const predictedCovariance = this.matAdd(
      this.matMul(this.matMul(this._motion_mat, covariance), this.transpose(this._motion_mat)),
      motionCov
    );
    
    return [predictedMean, predictedCovariance];
  }
  
  /**
   * Update state with measurement
   * @param mean Predicted state mean
   * @param covariance Predicted state covariance
   * @param measurement New measurement [x, y, w, h]
   * @returns Updated state mean and covariance
   */
  update(mean: number[], covariance: number[][], measurement: number[]): [number[], number[][]] {
    // Innovation
    const projectedMean = this.matVecMul(this._update_mat, mean);
    const innovation = measurement.map((m, i) => m - projectedMean[i]);
    
    // Innovation covariance
    const projectedCov = this.matAdd(
      this.matMul(this.matMul(this._update_mat, covariance), this.transpose(this._update_mat)),
      this.diag([
        this._std_weight_position * measurement[2] * this._std_weight_position * measurement[2],
        this._std_weight_position * measurement[3] * this._std_weight_position * measurement[3],
        this._std_weight_position * measurement[2] * this._std_weight_position * measurement[2],
        this._std_weight_position * measurement[3] * this._std_weight_position * measurement[3]
      ])
    );
    
    // Kalman gain
    const kalmanGain = this.matMul(
      this.matMul(covariance, this.transpose(this._update_mat)),
      this.inverse(projectedCov)
    );
    
    // Update state
    const updatedMean = mean.map((m, i) => {
      let sum = m;
      for (let j = 0; j < innovation.length; j++) {
        sum += kalmanGain[i][j] * innovation[j];
      }
      return sum;
    });
    
    // Update covariance
    const I = this.eye(8, 1);
    const IKH = this.matSub(I, this.matMul(kalmanGain, this._update_mat));
    const updatedCovariance = this.matMul(IKH, covariance);
    
    return [updatedMean, updatedCovariance];
  }
  
  /**
   * Compute gating distance
   * @param mean State mean
   * @param covariance State covariance
   * @param measurements Array of measurements
   * @returns Mahalanobis distances
   */
  gatingDistance(mean: number[], covariance: number[][], measurements: number[][]): number[] {
    const projectedMean = this.matVecMul(this._update_mat, mean);
    const projectedCov = this.matAdd(
      this.matMul(this.matMul(this._update_mat, covariance), this.transpose(this._update_mat)),
      this.R
    );
    
    const distances: number[] = [];
    const invCov = this.inverse(projectedCov);
    
    for (const measurement of measurements) {
      const diff = measurement.map((m, i) => m - projectedMean[i]);
      const distance = Math.sqrt(this.mahalanobis(diff, invCov));
      distances.push(distance);
    }
    
    return distances;
  }
  
  // Matrix operations
  private eye(n: number, val: number = 1): number[][] {
    const mat: number[][] = [];
    for (let i = 0; i < n; i++) {
      mat[i] = new Array(n).fill(0);
      mat[i][i] = val;
    }
    return mat;
  }
  
  private diag(values: number[]): number[][] {
    const n = values.length;
    const mat: number[][] = [];
    for (let i = 0; i < n; i++) {
      mat[i] = new Array(n).fill(0);
      mat[i][i] = values[i];
    }
    return mat;
  }
  
  private matMul(a: number[][], b: number[][]): number[][] {
    const rows = a.length;
    const cols = b[0].length;
    const inner = b.length;
    const result: number[][] = [];
    
    for (let i = 0; i < rows; i++) {
      result[i] = [];
      for (let j = 0; j < cols; j++) {
        let sum = 0;
        for (let k = 0; k < inner; k++) {
          sum += a[i][k] * b[k][j];
        }
        result[i][j] = sum;
      }
    }
    
    return result;
  }
  
  private matVecMul(mat: number[][], vec: number[]): number[] {
    return mat.map(row => 
      row.reduce((sum, val, i) => sum + val * vec[i], 0)
    );
  }
  
  private matAdd(a: number[][], b: number[][]): number[][] {
    return a.map((row, i) => row.map((val, j) => val + b[i][j]));
  }
  
  private matSub(a: number[][], b: number[][]): number[][] {
    return a.map((row, i) => row.map((val, j) => val - b[i][j]));
  }
  
  private transpose(mat: number[][]): number[][] {
    const rows = mat.length;
    const cols = mat[0].length;
    const result: number[][] = [];
    
    for (let j = 0; j < cols; j++) {
      result[j] = [];
      for (let i = 0; i < rows; i++) {
        result[j][i] = mat[i][j];
      }
    }
    
    return result;
  }
  
  private inverse(mat: number[][]): number[][] {
    // Simple 4x4 matrix inversion for measurement covariance
    const n = mat.length;
    if (n !== 4) throw new Error('Only 4x4 matrix inversion implemented');
    
    // Create augmented matrix [A|I]
    const aug: number[][] = mat.map((row, i) => [
      ...row,
      ...Array(n).fill(0).map((_, j) => i === j ? 1 : 0)
    ]);
    
    // Gauss-Jordan elimination
    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) {
          maxRow = k;
        }
      }
      
      // Swap rows
      [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
      
      // Make diagonal 1
      const diag = aug[i][i];
      for (let j = 0; j < 2 * n; j++) {
        aug[i][j] /= diag;
      }
      
      // Eliminate column
      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = aug[k][i];
          for (let j = 0; j < 2 * n; j++) {
            aug[k][j] -= factor * aug[i][j];
          }
        }
      }
    }
    
    // Extract inverse from augmented matrix
    const inv: number[][] = [];
    for (let i = 0; i < n; i++) {
      inv[i] = aug[i].slice(n);
    }
    
    return inv;
  }
  
  private mahalanobis(diff: number[], invCov: number[][]): number {
    let sum = 0;
    for (let i = 0; i < diff.length; i++) {
      for (let j = 0; j < diff.length; j++) {
        sum += diff[i] * invCov[i][j] * diff[j];
      }
    }
    return sum;
  }
}