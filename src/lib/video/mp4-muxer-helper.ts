import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export class MP4MuxerHelper {
  static async createMP4FromChunksWithMetadata(
    chunksWithMetadata: Array<{chunk: EncodedVideoChunk, metadata: any}>,
    encoderConfig: VideoEncoderConfig,
    decoderConfig: any,
    fps: number
  ): Promise<ArrayBuffer> {
    console.log('[MP4MuxerHelper] Creating MP4 from', chunksWithMetadata.length, 'chunks with metadata');
    console.log('[MP4MuxerHelper] Encoder config:', encoderConfig);
    console.log('[MP4MuxerHelper] First chunk metadata:', chunksWithMetadata[0]?.metadata);
    
    try {
      // Create muxer with ArrayBufferTarget
      const target = new ArrayBufferTarget();
      
      // Configure muxer options
      console.log('[MP4MuxerHelper] Creating muxer with config:', {
        codec: 'avc',
        width: encoderConfig.width,
        height: encoderConfig.height,
        frameRate: Math.round(fps),
        decoderConfig
      });
      
      const muxer = new Muxer({
        target,
        video: {
          codec: 'avc',
          width: encoderConfig.width!,
          height: encoderConfig.height!,
          frameRate: Math.round(fps)
        },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset'
      });
      
      // Add all chunks with their metadata
      console.log('[MP4MuxerHelper] Adding video chunks with metadata');
      
      // Track if we've passed decoder config
      let decoderConfigPassed = false;
      
      for (let i = 0; i < chunksWithMetadata.length; i++) {
        const { chunk, metadata } = chunksWithMetadata[i];
        
        try {
          // Log first few chunks for debugging
          if (i < 3) {
            console.log(`[MP4MuxerHelper] Chunk ${i} metadata:`, metadata);
            console.log(`[MP4MuxerHelper] Chunk ${i} type:`, chunk.type);
          }
          
          // Only pass metadata for the first keyframe that has decoderConfig
          // This is the standard pattern for mp4-muxer
          if (!decoderConfigPassed && chunk.type === 'key' && metadata && metadata.decoderConfig) {
            console.log('[MP4MuxerHelper] Passing first keyframe with decoderConfig');
            muxer.addVideoChunk(chunk, metadata);
            decoderConfigPassed = true;
          } else {
            // For all other chunks, don't pass metadata to avoid colorSpace errors
            muxer.addVideoChunk(chunk);
          }
          
          if (i % 100 === 0) {
            console.log(`[MP4MuxerHelper] Progress: ${i}/${chunksWithMetadata.length} chunks`);
          }
        } catch (chunkError) {
          console.error(`[MP4MuxerHelper] Error adding chunk ${i}:`, chunkError);
          console.error('Chunk details:', {
            type: chunk.type,
            timestamp: chunk.timestamp,
            duration: chunk.duration,
            byteLength: chunk.byteLength
          });
          console.error('Metadata details:', metadata);
          throw chunkError;
        }
      }
      
      // Finalize the muxer
      console.log('[MP4MuxerHelper] Finalizing MP4...');
      try {
        muxer.finalize();
      } catch (finalizeError) {
        console.error('[MP4MuxerHelper] Error during finalize:', finalizeError);
        console.error('[MP4MuxerHelper] Error stack:', (finalizeError as Error).stack);
        // Try to provide more context
        console.error('[MP4MuxerHelper] Muxer state before finalize:', {
          chunksAdded: chunksWithMetadata.length,
          encoderConfig,
          decoderConfig
        });
        throw finalizeError;
      }
      
      // Get the result
      const buffer = target.buffer;
      console.log('[MP4MuxerHelper] MP4 created, size:', buffer.byteLength);
      
      return buffer;
    } catch (error) {
      console.error('[MP4MuxerHelper] Fatal error:', error);
      throw error;
    }
  }
  
  // Keep the old method for backward compatibility
  static async createMP4FromChunks(
    chunks: EncodedVideoChunk[],
    encoderConfig: VideoEncoderConfig,
    decoderConfig: any,
    fps: number
  ): Promise<ArrayBuffer> {
    // Convert to new format
    const chunksWithMetadata = chunks.map(chunk => ({
      chunk,
      metadata: decoderConfig // Use decoder config as fallback metadata
    }));
    
    return this.createMP4FromChunksWithMetadata(
      chunksWithMetadata,
      encoderConfig,
      decoderConfig,
      fps
    );
  }
}