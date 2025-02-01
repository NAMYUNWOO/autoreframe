'use client';

import { useState, useRef, useEffect } from 'react';
import * as tf from '@tensorflow/tfjs';

export default function Home() {
  const [model, setModel] = useState<tf.GraphModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isVideoLoaded, setIsVideoLoaded] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 모델 로드
  useEffect(() => {
    async function loadModel() {
      try {
        await tf.setBackend('webgl');
        const loadedModel = await tf.loadGraphModel('/yolov8n_web_model/model.json');
        setModel(loadedModel);
        setIsLoading(false);
        // console.log('Model loaded successfully');
      } catch (error) {
        // console.error('Error loading model:', error);
        setIsLoading(false);
      }
    }
    loadModel();
  }, []);

  // 비디오 파일 처리
  const handleVideoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && videoRef.current) {
      const url = URL.createObjectURL(file);
      videoRef.current.src = url;
      
      // 비디오 로드 성공/실패 처리
      videoRef.current.onloadeddata = () => {
        // console.log('Video loaded successfully');
        setIsVideoLoaded(true);
        setIsDetecting(false);
        
        // 캔버스 크기를 비디오 크기에 맞춤
        if (canvasRef.current) {
          canvasRef.current.width = videoRef.current!.videoWidth;
          canvasRef.current.height = videoRef.current!.videoHeight;
        }
      };
      
      videoRef.current.onerror = (e) => {
        // console.error('Video load error:', e);
        alert('비디오 파일을 재생할 수 없습니다. MP4 형식으로 변환 후 다시 시도해주세요.');
        setIsVideoLoaded(false);
      };
    }
  };

  // 컴포넌트 언마운트 시 리소스 정리
  useEffect(() => {
    return () => {
      if (videoRef.current?.src) {
        URL.revokeObjectURL(videoRef.current.src);
      }
    };
  }, []);

  // 객체 감지 시작
  const startDetection = async () => {
    // console.log('Starting detection...');

    if (!model || !videoRef.current || !canvasRef.current) {
        // console.error('Missing required elements:', {
        //   model: !!model,
        //   video: !!videoRef.current,
        //   canvas: !!canvasRef.current
        // });
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      // console.error('Failed to get canvas context');
      return;
    }

    // 캔버스 크기 설정
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    // console.log('Canvas dimensions:', {
    //   width: canvas.width,
    //   height: canvas.height,
    //   videoWidth: video.videoWidth,
    //   videoHeight: video.videoHeight
    // });

    setIsDetecting(true);
    video.play();

    const detectFrame = async () => {
      try {
        if (!video.readyState === video.HAVE_ENOUGH_DATA) {
          requestAnimationFrame(detectFrame);
          return;
        }

        // 비디오가 일시정지되거나 종료된 경우에도 계속 감지
        if (video.paused || video.ended) {
          // console.log('Video paused or ended, continuing detection...');
          requestAnimationFrame(detectFrame);
          return;
        }

        // console.log('Processing new frame...');
        
        // 비디오 프레임을 텐서로 변환
        const tfImg = tf.browser.fromPixels(video);
        const resized = tf.image.resizeBilinear(tfImg, [640, 640]);
        const input = resized.div(255.0).expandDims(0);

        // 객체 감지 실행
        const result = await model.predict(input) as tf.Tensor;
        // console.log('Model output shape:', result.shape);

        // 출력 텐서 변환 (transpose)
        const transposed = tf.transpose(result, [0, 2, 1]);
        const boxes = await transposed.array();
        // console.log('Transposed shape:', transposed.shape);

      // 원본 캔버스에 비디오 프레임 그리기
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // YOLOv8 출력 처리
        const detections = [];
        const confidenceThreshold = 0.5;

        // 각 detection 처리 (8400개의 가능한 객체)
        for (let i = 0; i < boxes[0].length; i++) {
          const detection = boxes[0][i];
          
          // 클래스 scores는 4번 인덱스부터 시작
          const scores = detection.slice(4);
          const maxScore = Math.max(...scores);
          const maxScoreIndex = scores.indexOf(maxScore);

          // person 클래스(index 0)이고 confidence가 threshold 이상인 경우만 처리
          if (maxScoreIndex === 0 && maxScore > confidenceThreshold) {
            // 박스 좌표 추출 (x, y, w, h)
            const x = detection[0];
            const y = detection[1];
            const w = detection[2];
            const h = detection[3];

            detections.push({
              bbox: [x, y, w, h],
              score: maxScore
            });
          }
        }

        console.log('Detected persons:', detections.length);

        // 감지된 객체 그리기
        detections.forEach((det, index) => {
          const [x, y, w, h] = det.bbox;
          const score = det.score;

          // 박스 좌표를 캔버스 크기에 맞게 변환
          const xScale = canvas.width / 640;
          const yScale = canvas.height / 640;

          // 중심점과 크기를 왼쪽 상단 좌표와 너비/높이로 변환
          const boxX = (x - w/2) * xScale;
          const boxY = (y - h/2) * yScale;
          const boxWidth = w * xScale;
          const boxHeight = h * yScale;

          // 바운딩 박스 그리기
          ctx.strokeStyle = '#00ff00';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.rect(boxX, boxY, boxWidth, boxHeight);
          ctx.stroke();

          // 텍스트 그리기
          const label = `Person ${index} (${Math.round(score * 100)}%)`;
          ctx.fillStyle = '#00ff00';
          ctx.font = 'bold 16px Arial';
          ctx.fillText(label, boxX, boxY - 5);

          // console.log(`Detection ${index}:`, {
          //   bbox: [boxX, boxY, boxWidth, boxHeight],
          //   confidence: score
          // });
        });

        // 메모리 정리
        tf.dispose([tfImg, resized, input, result, transposed]);

        requestAnimationFrame(detectFrame);
      } catch (error) {
        // console.error('Error in detection:', error);
        // console.error('Error details:', {
        //   modelLoaded: !!model,
        //   videoReady: video.readyState,
        //   canvasContext: !!ctx
        // });
        requestAnimationFrame(detectFrame);
      }
    };

    // 초기 detectFrame 호출
    // console.log('Starting detection loop...');
    detectFrame();
  };

  // 감지 중지
  const stopDetection = () => {
    // console.log('Stopping detection...');
    setIsDetecting(false);
    if (videoRef.current) {
      videoRef.current.pause();
    }
    // 캔버스 초기화
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    // console.log('Detection stopped');
  };

  return (
    <div className="min-h-screen p-8 flex flex-col items-center">
      <main className="w-full max-w-4xl flex flex-col gap-8 items-center">
        <h1 className="text-2xl font-bold">Person Detection</h1>
        
        {isLoading ? (
          <div className="text-center">Loading YOLO model...</div>
        ) : (
          <div className="w-full flex flex-col gap-4">
            <input
              type="file"
              accept="video/*,.mov,.mp4,.webm"
              onChange={handleVideoUpload}
              className="mb-4"
            />
            <div className="relative w-full aspect-video bg-black">
              <video
                ref={videoRef}
                className="absolute top-0 left-0 w-full h-full"
                controls
                playsInline
                preload="auto"
                crossOrigin="anonymous"
                style={{ objectFit: 'contain' }}
              />
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full pointer-events-none"
                style={{ objectFit: 'contain' }}
              />
            </div>
            <div className="flex gap-4 justify-center">
              <button
                onClick={startDetection}
                disabled={!isVideoLoaded || isDetecting}
                className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-300"
              >
                Start Detection
              </button>
              <button
                onClick={stopDetection}
                disabled={!isDetecting}
                className="px-4 py-2 bg-red-500 text-white rounded disabled:bg-gray-300"
              >
                Stop Detection
              </button>
            </div>
            {!isVideoLoaded && videoRef.current?.src && (
              <div className="text-center text-yellow-600">
                비디오 로딩 중...
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}