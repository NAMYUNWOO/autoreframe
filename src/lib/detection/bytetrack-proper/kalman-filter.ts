export class KalmanFilter {
  private _motion_mat: number[][];
  private _update_mat: number[][];
  private _std_weight_position: number;
  private _std_weight_velocity: number;

  constructor() {
    // Motion matrix (F)
    this._motion_mat = [
      [1, 0, 0, 0, 1, 0, 0, 0],
      [0, 1, 0, 0, 0, 1, 0, 0],
      [0, 0, 1, 0, 0, 0, 1, 0],
      [0, 0, 0, 1, 0, 0, 0, 1],
      [0, 0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, 0, 0, 1]
    ];

    // Measurement matrix (H)
    this._update_mat = [
      [1, 0, 0, 0, 0, 0, 0, 0],
      [0, 1, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0, 0]
    ];

    this._std_weight_position = 1.0 / 20;
    this._std_weight_velocity = 1.0 / 160;
  }

  /**
   * Initialize track from bounding box.
   * State: [x, y, a, h, vx, vy, va, vh]
   * where x,y is center position, a is aspect ratio, h is height
   */
  initiate(measurement: number[]): [number[], number[][]] {
    const [x1, y1, x2, y2] = measurement;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const w = x2 - x1;
    const h = y2 - y1;
    const a = w / h;

    const mean = [cx, cy, a, h, 0, 0, 0, 0];
    
    // Initialize covariance
    const std = [
      2 * this._std_weight_position * h,
      2 * this._std_weight_position * h,
      1e-2,
      2 * this._std_weight_position * h,
      10 * this._std_weight_velocity * h,
      10 * this._std_weight_velocity * h,
      1e-5,
      10 * this._std_weight_velocity * h
    ];

    const covariance = this.diag(std.map(s => s * s));
    return [mean, covariance];
  }

  /**
   * Predict next state
   */
  predict(mean: number[], covariance: number[][]): [number[], number[][]] {
    // State prediction: x' = F * x
    const predicted_mean = this.matmul(this._motion_mat, mean) as number[];
    
    // Covariance prediction: P' = F * P * F^T + Q
    const temp = this.matmul(this._motion_mat, covariance) as number[][];
    const predicted_covariance = this.matmul(temp, this.transpose(this._motion_mat)) as number[][];
    
    // Add process noise
    const std = [
      this._std_weight_position * predicted_mean[3],
      this._std_weight_position * predicted_mean[3],
      1e-2,
      this._std_weight_position * predicted_mean[3],
      this._std_weight_velocity * predicted_mean[3],
      this._std_weight_velocity * predicted_mean[3],
      1e-5,
      this._std_weight_velocity * predicted_mean[3]
    ];
    
    const Q = this.diag(std.map(s => s * s));
    for (let i = 0; i < 8; i++) {
      predicted_covariance[i][i] += Q[i][i];
    }

    return [predicted_mean, predicted_covariance];
  }

  /**
   * Update state with measurement
   */
  update(mean: number[], covariance: number[][], measurement: number[]): [number[], number[][]] {
    const [x1, y1, x2, y2] = measurement;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const w = x2 - x1;
    const h = y2 - y1;
    const a = w / h;

    const meas = [cx, cy, a, h];
    
    // Innovation: y = z - H * x
    const predicted_meas = this.matmul(this._update_mat, mean) as number[];
    const innovation = meas.map((m, i) => m - predicted_meas[i]);
    
    // Innovation covariance: S = H * P * H^T + R
    const temp = this.matmul(this._update_mat, covariance) as number[][];
    const S = this.matmul(temp, this.transpose(this._update_mat)) as number[][];
    
    // Add measurement noise
    const std = [
      this._std_weight_position * mean[3],
      this._std_weight_position * mean[3],
      1e-1,
      this._std_weight_position * mean[3]
    ];
    
    for (let i = 0; i < 4; i++) {
      S[i][i] += std[i] * std[i];
    }
    
    // Kalman gain: K = P * H^T * S^-1
    const temp2 = this.matmul(covariance, this.transpose(this._update_mat)) as number[][];
    const K = this.matmul(temp2, this.inverse(S)) as number[][];
    
    // State update: x = x + K * y
    const state_update = this.matmul(K, innovation) as number[];
    const updated_mean = mean.map((m, i) => m + state_update[i]);
    
    // Covariance update: P = (I - K * H) * P
    const I = this.eye(8);
    const temp3 = this.matmul(K, this._update_mat) as number[][];
    const I_KH = this.subtract(I, temp3);
    const updated_covariance = this.matmul(I_KH, covariance) as number[][];

    return [updated_mean, updated_covariance];
  }

  /**
   * Convert state to bounding box
   */
  stateToBbox(state: number[]): number[] {
    const [cx, cy, a, h] = state;
    const w = a * h;
    return [cx - w/2, cy - h/2, cx + w/2, cy + h/2];
  }

  // Matrix operations
  private diag(values: number[]): number[][] {
    const n = values.length;
    const result: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      result[i][i] = values[i];
    }
    return result;
  }

  private eye(n: number): number[][] {
    const result: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      result[i][i] = 1;
    }
    return result;
  }

  private matmul(A: number[][], B: number[] | number[][]): number[] | number[][] {
    if (!Array.isArray(B[0])) {
      // Matrix-vector multiplication
      const b = B as number[];
      return A.map(row => row.reduce((sum, val, i) => sum + val * b[i], 0));
    } else {
      // Matrix-matrix multiplication
      const b = B as number[][];
      const result: number[][] = Array(A.length).fill(0).map(() => Array(b[0].length).fill(0));
      for (let i = 0; i < A.length; i++) {
        for (let j = 0; j < b[0].length; j++) {
          for (let k = 0; k < A[0].length; k++) {
            result[i][j] += A[i][k] * b[k][j];
          }
        }
      }
      return result;
    }
  }

  private transpose(A: number[][]): number[][] {
    return A[0].map((_, i) => A.map(row => row[i]));
  }

  private subtract(A: number[][], B: number[][]): number[][] {
    return A.map((row, i) => row.map((val, j) => val - B[i][j]));
  }

  private inverse(A: number[][]): number[][] {
    // Simple 4x4 matrix inversion for measurement covariance
    const n = A.length;
    const augmented: number[][] = A.map((row, i) => [...row, ...Array(n).fill(0).map((_, j) => i === j ? 1 : 0)]);
    
    // Gaussian elimination
    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
          maxRow = k;
        }
      }
      [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
      
      // Make diagonal 1
      const pivot = augmented[i][i];
      for (let j = 0; j < 2 * n; j++) {
        augmented[i][j] /= pivot;
      }
      
      // Eliminate column
      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = augmented[k][i];
          for (let j = 0; j < 2 * n; j++) {
            augmented[k][j] -= factor * augmented[i][j];
          }
        }
      }
    }
    
    // Extract inverse
    return augmented.map(row => row.slice(n));
  }
}