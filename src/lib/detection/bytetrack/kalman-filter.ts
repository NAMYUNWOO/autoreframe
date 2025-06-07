import * as tf from '@tensorflow/tfjs';

/**
 * A simple Kalman filter for tracking bounding boxes in image space.
 * 
 * The 8-dimensional state space (x, y, a, h, vx, vy, va, vh) contains
 * the bounding box center position (x, y), aspect ratio a, height h,
 * and their respective velocities.
 */
export class KalmanFilter {
  private motionMat: tf.Tensor2D;
  private updateMat: tf.Tensor2D;
  private stdWeightPosition: number = 1 / 40;  // Reduced for more stable tracking
  private stdWeightVelocity: number = 1 / 320; // Reduced for smoother velocity

  constructor() {
    // Initialize motion matrix (state transition matrix)
    const ndim = 4;
    const dt = 1;
    const motionMatData = Array(2 * ndim).fill(null).map(() => Array(2 * ndim).fill(0));
    
    // Identity matrix
    for (let i = 0; i < 2 * ndim; i++) {
      motionMatData[i][i] = 1;
    }
    
    // Add velocity components
    for (let i = 0; i < ndim; i++) {
      motionMatData[i][ndim + i] = dt;
    }
    
    this.motionMat = tf.tensor2d(motionMatData);
    
    // Update matrix (observation matrix)
    const updateMatData = Array(ndim).fill(null).map(() => Array(2 * ndim).fill(0));
    for (let i = 0; i < ndim; i++) {
      updateMatData[i][i] = 1;
    }
    this.updateMat = tf.tensor2d(updateMatData);
  }

  /**
   * Create track from unassociated measurement
   * @param measurement Bounding box coordinates (x, y, a, h) with center position,
   *                    aspect ratio, and height
   * @returns Mean vector (8D) and covariance matrix (8x8)
   */
  initiate(measurement: number[]): [Float32Array, Float32Array] {
    const meanPos = measurement;
    const meanVel = new Array(4).fill(0);
    const mean = [...meanPos, ...meanVel];

    const h = measurement[3];
    const std = [
      2 * this.stdWeightPosition * h,
      2 * this.stdWeightPosition * h,
      1e-2,
      2 * this.stdWeightPosition * h,
      10 * this.stdWeightVelocity * h,
      10 * this.stdWeightVelocity * h,
      1e-5,
      10 * this.stdWeightVelocity * h
    ];

    // Create diagonal covariance matrix
    const covariance = new Float32Array(64);
    for (let i = 0; i < 8; i++) {
      covariance[i * 8 + i] = std[i] * std[i];
    }

    return [new Float32Array(mean), covariance];
  }

  /**
   * Run Kalman filter prediction step
   */
  predict(mean: Float32Array, covariance: Float32Array): [Float32Array, Float32Array] {
    const h = mean[3];
    const stdPos = [
      this.stdWeightPosition * h,
      this.stdWeightPosition * h,
      1e-2,
      this.stdWeightPosition * h
    ];
    const stdVel = [
      this.stdWeightVelocity * h,
      this.stdWeightVelocity * h,
      1e-5,
      this.stdWeightVelocity * h
    ];

    // Motion noise covariance
    const motionCov = new Float32Array(64);
    const stds = [...stdPos, ...stdVel];
    for (let i = 0; i < 8; i++) {
      motionCov[i * 8 + i] = stds[i] * stds[i];
    }

    // Predict mean: mean = motion_mat @ mean
    const meanTensor = tf.tensor1d(mean);
    const motionMatT = this.motionMat.transpose();
    const predictedMeanTensor = tf.matMul(meanTensor.expandDims(0), motionMatT);
    const predictedMean = predictedMeanTensor.dataSync() as Float32Array;

    // Predict covariance
    const covTensor = tf.tensor2d(covariance, [8, 8]);
    const predictedCovTensor = tf.add(
      tf.matMul(tf.matMul(this.motionMat, covTensor), motionMatT),
      tf.tensor2d(motionCov, [8, 8])
    );
    const predictedCov = predictedCovTensor.dataSync() as Float32Array;

    // Clean up tensors
    meanTensor.dispose();
    predictedMeanTensor.dispose();
    covTensor.dispose();
    predictedCovTensor.dispose();

    return [predictedMean, predictedCov];
  }

  /**
   * Run Kalman filter correction step
   */
  update(mean: Float32Array, covariance: Float32Array, measurement: number[]): [Float32Array, Float32Array] {
    const [projectedMean, projectedCov] = this.project(mean, covariance);
    
    // For simplicity, use a simplified Kalman update
    // This avoids matrix inversion issues
    const kalmanGain = new Float32Array(32); // 8x4
    const alpha = 0.5; // Simple gain factor
    
    // Simple gain calculation
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 4; j++) {
        if (i === j) {
          kalmanGain[i * 4 + j] = alpha;
        } else if (i === j + 4) {
          kalmanGain[i * 4 + j] = alpha * 0.5; // Velocity components
        }
      }
    }
    
    // Innovation
    const innovation = measurement.map((m, i) => m - projectedMean[i]);
    
    // Update mean
    const newMean = new Float32Array(mean);
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 4; j++) {
        newMean[i] += kalmanGain[i * 4 + j] * innovation[j];
      }
    }
    
    // Simple covariance update
    const newCov = new Float32Array(covariance);
    const scale = 1 - alpha;
    for (let i = 0; i < 64; i++) {
      newCov[i] *= scale;
    }
    
    return [newMean, newCov];
  }

  /**
   * Project state distribution to measurement space
   */
  private project(mean: Float32Array, covariance: Float32Array): [Float32Array, Float32Array] {
    const h = mean[3];
    const std = [
      this.stdWeightPosition * h,
      this.stdWeightPosition * h,
      1e-1,
      this.stdWeightPosition * h
    ];
    
    // Innovation covariance
    const innovationCov = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      innovationCov[i * 4 + i] = std[i] * std[i];
    }
    
    // Project mean
    const meanTensor = tf.tensor1d(mean);
    const projectedMeanTensor = tf.matMul(this.updateMat, meanTensor.expandDims(1));
    const projectedMean = projectedMeanTensor.dataSync() as Float32Array;
    
    // Project covariance
    const covTensor = tf.tensor2d(covariance, [8, 8]);
    const updateMatT = this.updateMat.transpose();
    const projectedCovTensor = tf.add(
      tf.matMul(tf.matMul(this.updateMat, covTensor), updateMatT),
      tf.tensor2d(innovationCov, [4, 4])
    );
    const projectedCov = projectedCovTensor.dataSync() as Float32Array;
    
    // Clean up
    meanTensor.dispose();
    projectedMeanTensor.dispose();
    covTensor.dispose();
    projectedCovTensor.dispose();
    
    return [projectedMean, projectedCov];
  }

  dispose(): void {
    this.motionMat.dispose();
    this.updateMat.dispose();
  }
}