import { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

export function useLiveAPI() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [voiceName, setVoiceName] = useState<'Fenrir' | 'Kore'>('Kore');
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioQueue = useRef<Int16Array[]>([]);
  const nextPlayTimeRef = useRef<number>(0);

  const cleanup = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    audioQueue.current = [];
    nextPlayTimeRef.current = 0;
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const playNextChunk = useCallback(() => {
    if (!audioContextRef.current) return;

    while (audioQueue.current.length > 0) {
      const chunk = audioQueue.current.shift()!;
      
      const float32Data = new Float32Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) {
        float32Data[i] = chunk[i] / 32768.0;
      }

      const audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
      audioBuffer.getChannelData(0).set(float32Data);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);

      const currentTime = audioContextRef.current.currentTime;
      if (nextPlayTimeRef.current < currentTime) {
        nextPlayTimeRef.current = currentTime + 0.05; // 50ms buffer to prevent underrun
      }

      source.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += audioBuffer.duration;
    }
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("API Key is missing. Please configure GEMINI_API_KEY in the Secrets panel.");
      }
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
      processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);

      let sessionPromise: Promise<any>;
      
      sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } },
          },
          systemInstruction: "You are TextilePro AI, a professional textile expert created by Tasin Ahmed. If anyone asks who made you or who created you, always mention Tasin Ahmed. Respond concisely and professionally in both English and Bangla. Your tone is helpful and technical.",
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            
            processorRef.current?.addEventListener('audioprocess', (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
              }
              
              const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
              sessionPromise.then((session) => {
                session.sendRealtimeInput({
                  media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                });
              });
            });

            sourceRef.current?.connect(processorRef.current!);
            processorRef.current?.connect(audioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
              const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
              const binaryString = atob(base64Audio);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const pcmData = new Int16Array(bytes.buffer);
              audioQueue.current.push(pcmData);
              playNextChunk();
            }

            if (message.serverContent?.interrupted) {
              audioQueue.current = [];
              nextPlayTimeRef.current = 0;
            }
          },
          onclose: () => cleanup(),
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Connection failed. Please try again.");
            cleanup();
          }
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Setup Error:", err);
      setError("Could not access microphone or connect to AI.");
      cleanup();
    }
  }, [cleanup, playNextChunk, voiceName]);

  return { isConnected, isConnecting, error, transcription, voiceName, setVoiceName, connect, disconnect: cleanup };
}
