import { ByteTracker } from './bytetrack-proper/byte-tracker';
import { HeadDetector } from './head-detector';
import { BoundingBox, Detection } from '@/types';

export interface PersonWithHead extends BoundingBox {
  headBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
  };
  headCenterX?: number;
  headCenterY?: number;
}

export class PersonHeadTracker {
  private byteTracker: ByteTracker;
  private headDetector: HeadDetector;
  private initialized: boolean = false;
  
  constructor(byteTrackerParams?: any) {
    this.byteTracker = new ByteTracker(byteTrackerParams);
    this.headDetector = new HeadDetector();
  }
  
  async initialize(): Promise<void> {
    if (!this.initialized) {
      await this.headDetector.initialize();
      this.initialized = true;
    }
  }
  
  /**
   * Process frame: detect persons with ByteTracker, then find heads
   */
  async processFrame(
    personBoxes: BoundingBox[],
    imageData: ImageData | HTMLCanvasElement
  ): Promise<PersonWithHead[]> {
    // First, track persons with ByteTracker
    const trackedPersons = this.byteTracker.update(personBoxes);
    
    // Then, detect head for each tracked person
    const personsWithHeads: PersonWithHead[] = [];
    
    for (const person of trackedPersons) {
      const personWithHead: PersonWithHead = { ...person };
      
      // Detect head within person box with reduced padding
      const headDetection = await this.headDetector.detectHeadInBox(
        imageData,
        person,
        0.05 // 5% padding instead of default 10%
      );
      
      if (headDetection) {
        personWithHead.headBox = headDetection;
        personWithHead.headCenterX = headDetection.x + headDetection.width / 2;
        personWithHead.headCenterY = headDetection.y + headDetection.height / 2;
        
        console.log(`Person ${person.trackId}: Head detected at (${personWithHead.headCenterX}, ${personWithHead.headCenterY})`);
      } else {
        // Fallback: estimate head position (top 25% of person box)
        personWithHead.headCenterX = person.x + person.width / 2;
        personWithHead.headCenterY = person.y + person.height * 0.25;
        
        console.log(`Person ${person.trackId}: Head estimated at (${personWithHead.headCenterX}, ${personWithHead.headCenterY})`);
      }
      
      personsWithHeads.push(personWithHead);
    }
    
    return personsWithHeads;
  }
  
  /**
   * Convert PersonWithHead array to Detection format
   */
  toDetection(personsWithHeads: PersonWithHead[], frameNumber: number, timestamp: number): Detection {
    return {
      frameNumber,
      timestamp,
      boxes: personsWithHeads.map(p => ({
        x: p.x,
        y: p.y,
        width: p.width,
        height: p.height,
        confidence: p.confidence,
        class: p.class,
        classId: p.classId,
        trackId: p.trackId,
        // Store head center in the box data
        headCenterX: p.headCenterX,
        headCenterY: p.headCenterY
      } as BoundingBox & { headCenterX?: number; headCenterY?: number }))
    };
  }
  
  reset(): void {
    this.byteTracker.reset();
  }
  
  dispose(): void {
    this.headDetector.dispose();
  }
}