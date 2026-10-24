// AudioWorklet: mono PCM only; output remains silent to prevent microphone feedback.
class PCMCapture extends AudioWorkletProcessor {
  constructor(){
    super(); this.buffer=new Float32Array(Math.round(sampleRate/5)); this.offset=0;
    this.port.onmessage=({data})=>{if(data==='flush'){this.flush();this.port.postMessage({type:'flushed'});}};
  }
  flush(){if(this.offset){const audio=this.buffer.slice(0,this.offset);this.port.postMessage({type:'audio',audio},[audio.buffer]);this.offset=0;}}
  process(inputs){
    const channels=inputs[0];if(!channels?.length)return true;
    for(let i=0;i<channels[0].length;i++){
      let value=0;for(const channel of channels)value+=channel[i];
      this.buffer[this.offset++]=value/channels.length;
      if(this.offset===this.buffer.length)this.flush();
    }
    return true;
  }
}
registerProcessor('pcm-capture',PCMCapture);
