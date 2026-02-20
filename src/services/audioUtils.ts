
export class AudioRecorder {
  private audioContext: AudioContext;
  private processor: ScriptProcessorNode | null = null;
  private stream: MediaStream | null = null;
  private onAudioData: (data: string) => void;
  private destination: MediaStreamAudioDestinationNode | null = null;

  constructor(audioContext: AudioContext, onAudioData: (data: string) => void, destination?: MediaStreamAudioDestinationNode) {
    this.audioContext = audioContext;
    this.onAudioData = onAudioData;
    this.destination = destination || null;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = this.audioContext.createMediaStreamSource(this.stream);
    
    if (this.destination) {
      source.connect(this.destination);
    }

    // We need to resample to 16000 for Gemini
    // For simplicity in this mock, we'll use the context's sample rate and assume the backend handles it 
    // OR we can use a simpler approach: create a separate context for recording if needed, 
    // but here we must share for the MediaRecorder destination.
    
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    
    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      
      // Basic downsampling if needed (very crude)
      // Gemini expects 16000. If context is 48000, we take every 3rd sample.
      const ratio = this.audioContext.sampleRate / 16000;
      const newLength = Math.floor(inputData.length / ratio);
      const pcm16 = new Int16Array(newLength);
      
      for (let i = 0; i < newLength; i++) {
        const index = Math.floor(i * ratio);
        pcm16[i] = Math.max(-1, Math.min(1, inputData[index])) * 0x7FFF;
      }
      
      const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
      this.onAudioData(base64);
    };

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  stop() {
    this.processor?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
  }
}

export class AudioPlayer {
  private audioContext: AudioContext;
  private nextStartTime: number = 0;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private activeSources: Set<AudioBufferSourceNode> = new Set();

  constructor(audioContext: AudioContext, destination?: MediaStreamAudioDestinationNode) {
    this.audioContext = audioContext;
    this.destination = destination || null;
  }

  async playChunk(base64Data: string) {
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768;
    }

    // Gemini sends 24000Hz
    const audioBuffer = this.audioContext.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    
    if (this.destination) {
      source.connect(this.destination);
    }

    const currentTime = this.audioContext.currentTime;
    const startTime = Math.max(currentTime, this.nextStartTime);
    
    source.onended = () => {
      this.activeSources.delete(source);
    };
    
    this.activeSources.add(source);
    source.start(startTime);
    this.nextStartTime = startTime + audioBuffer.duration;
  }

  stop() {
    this.activeSources.forEach(source => {
      try {
        source.stop();
      } catch (e) {
        // Source might have already stopped
      }
    });
    this.activeSources.clear();
    this.nextStartTime = 0;
  }
}
