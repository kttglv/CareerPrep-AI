
import React, { useEffect, useRef, useState } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { generateFeedback, getInterviewerSystemInstruction } from './geminiService';
import { AudioRecorder, AudioPlayer } from './audioUtils';
import { Mic, MicOff, RefreshCw, Bot, User, Award, ArrowRight, Pause, Play, Square, VolumeX, Volume2, List, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';

interface LiveInterviewSessionProps {
  resume: string;
  role: string;
  onComplete: (feedback: string) => void;
  onStop: () => void;
}

export const LiveInterviewSession: React.FC<LiveInterviewSessionProps> = ({ resume, role, onComplete, onStop }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isInterrupted, setIsInterrupted] = useState(false);
  const [transcription, setTranscription] = useState<{ role: 'user' | 'model', text: string }[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  
  const aiRef = useRef<any>(null);
  const sessionRef = useRef<any>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isCancelledRef = useRef(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcription]);

  const startSession = async () => {
    if (isCancelledRef.current) return;
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      aiRef.current = ai;

      // Setup recording destination
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = audioCtx;
      const destination = audioCtx.createMediaStreamDestination();
      
      mediaRecorderRef.current = new MediaRecorder(destination.stream);
      audioChunksRef.current = [];
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecordingUrl(url);
      };

      playerRef.current = new AudioPlayer(audioCtx, destination);
      recorderRef.current = new AudioRecorder(audioCtx, (base64) => {
        if (sessionRef.current && !isPaused && !isMuted) {
          sessionRef.current.sendRealtimeInput({
            media: { data: base64, mimeType: 'audio/pcm;rate=16000' }
          });
        }
      }, destination);

      mediaRecorderRef.current.start();

      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: getInterviewerSystemInstruction(role, resume),
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            if (isCancelledRef.current) return;
            setIsConnected(true);
            recorderRef.current?.start();
          },
          onmessage: async (message: any) => {
            if (isCancelledRef.current) return;
            
            // Handle Audio Output
            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && !isPaused) {
              setIsSpeaking(true);
              playerRef.current?.playChunk(audioData);
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              setIsInterrupted(true);
              playerRef.current?.stop();
            }

            // Handle Transcriptions
            const modelText = message.serverContent?.modelTurn?.parts?.[0]?.text;
            if (modelText) {
              setTranscription(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'model') {
                  // If the last message was also from the model, append to it
                  // This prevents multiple bubbles for the same AI turn
                  return [...prev.slice(0, -1), { role: 'model', text: last.text + " " + modelText }];
                }
                return [...prev, { role: 'model', text: modelText }];
              });
              
              if (modelText.toLowerCase().includes('interview is complete')) {
                setIsComplete(true);
                onComplete(modelText);
              }
            }
            
            const userText = message.serverContent?.userTurn?.parts?.[0]?.text;
            if (userText) {
              setTranscription(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'user') {
                  // Merge consecutive user transcriptions
                  return [...prev.slice(0, -1), { role: 'user', text: last.text + " " + userText }];
                }
                return [...prev, { role: 'user', text: userText }];
              });
            }
          },
          onclose: () => setIsConnected(false),
          onerror: (err) => console.error("Live API Error:", err),
        }
      });

      const session = await sessionPromise;
      if (isCancelledRef.current) {
        session.close();
        return;
      }
      sessionRef.current = session;
    } catch (err) {
      console.error("Failed to start live session:", err);
    }
  };

  const [isGeneratingFeedback, setIsGeneratingFeedback] = useState(false);

  const stopSession = () => {
    recorderRef.current?.stop();
    playerRef.current?.stop();
    sessionRef.current?.close();
    mediaRecorderRef.current?.stop();
    audioCtxRef.current?.close();
    setIsConnected(false);
  };

  const handleUserStop = async () => {
    if (transcription.length > 0) {
      setIsGeneratingFeedback(true);
      try {
        const transcriptText = transcription.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n');
        const feedback = await generateFeedback(transcriptText, role);
        if (feedback) {
          onComplete(feedback);
          return;
        }
      } catch (err) {
        console.error("Failed to generate feedback on stop:", err);
      } finally {
        setIsGeneratingFeedback(false);
      }
    }
    stopSession();
    onStop();
  };

  useEffect(() => {
    isCancelledRef.current = false;
    startSession();
    return () => {
      isCancelledRef.current = true;
      stopSession();
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-50 rounded-[2.5rem] overflow-hidden border border-slate-200 shadow-sm">
      {/* Header */}
      <div className="p-6 bg-white border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn("w-3 h-3 rounded-full", isConnected ? "bg-emerald-500 animate-pulse" : "bg-slate-300")}></div>
          <span className="text-sm font-bold text-slate-700 uppercase tracking-widest">
            {isConnected ? "Live Interview in Progress" : "Connecting..."}
          </span>
        </div>
        <button 
          onClick={handleUserStop}
          className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 transition-colors"
        >
          <MicOff size={20} />
        </button>
      </div>

      {/* Transcription Area / Live Status */}
      <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-hide">
        {isGeneratingFeedback ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
            <div className="w-20 h-20 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-slate-900">Generating Feedback...</h3>
              <p className="text-sm text-slate-500">Please wait while we analyze your interview performance.</p>
            </div>
          </div>
        ) : !showSummary ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
            <div className="relative">
              <div className={cn(
                "w-32 h-32 rounded-full flex items-center justify-center border-4 transition-all duration-500",
                isConnected ? (isSpeaking ? "border-indigo-500 bg-indigo-50" : "border-emerald-500 bg-emerald-50") : "border-slate-200 bg-slate-50"
              )}>
                {isSpeaking ? (
                  <Bot size={48} className="text-indigo-600 animate-bounce" />
                ) : (
                  <User size={48} className={cn(isConnected ? "text-emerald-600" : "text-slate-400")} />
                )}
              </div>
              {isConnected && (
                <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-white rounded-full shadow-md flex items-center justify-center border border-slate-100">
                  <div className={cn("w-3 h-3 rounded-full", isSpeaking ? "bg-indigo-500 animate-pulse" : "bg-emerald-500")}></div>
                </div>
              )}
            </div>
            
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-slate-900">
                {isComplete ? "Interview Concluded" : (isPaused ? "Interview Paused" : (isSpeaking ? "Interviewer is Speaking" : "Listening to You"))}
              </h3>
              <p className="text-sm text-slate-500 max-w-xs mx-auto">
                {isComplete 
                  ? "You've finished the session. Click below to see the full summary." 
                  : (isPaused ? "The session is currently on hold." : "Speak naturally as if you were in a real interview.")}
              </p>
            </div>

            {isComplete && (
              <div className="flex flex-col gap-3 items-center">
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={() => setShowSummary(true)}
                  className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                >
                  <List size={20} />
                  Summarize Interview
                </motion.button>
                
                {recordingUrl && (
                  <motion.a
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    href={recordingUrl}
                    download="interview-recording.webm"
                    className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-600 rounded-2xl font-bold hover:bg-slate-50 transition-all shadow-sm"
                  >
                    <Download size={20} />
                    Download Recording
                  </motion.a>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <List size={20} className="text-indigo-600" />
                Interview Transcript
              </h3>
              <button 
                onClick={() => setShowSummary(false)}
                className="text-xs font-bold text-indigo-600 uppercase tracking-widest hover:underline"
              >
                Back to Live View
              </button>
            </div>
            {transcription.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex gap-4 max-w-[85%]",
                  msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                )}
              >
                <div className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm",
                  msg.role === 'user' ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-600"
                )}>
                  {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                </div>
                <div className={cn(
                  "p-4 rounded-2xl text-sm leading-relaxed",
                  msg.role === 'user' 
                    ? "bg-indigo-600 text-white rounded-tr-none" 
                    : "bg-white text-slate-800 border border-slate-100 rounded-tl-none"
                )}>
                  <Markdown>{msg.text}</Markdown>
                </div>
              </motion.div>
            ))}
            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* Footer / Controls */}
      <div className="p-8 bg-white border-t border-slate-100 flex flex-col items-center gap-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsMuted(!isMuted)}
            disabled={isGeneratingFeedback}
            className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center transition-all border shadow-sm disabled:opacity-50",
              isMuted ? "bg-red-50 border-red-100 text-red-500" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>

          <button
            onClick={() => setIsPaused(!isPaused)}
            disabled={isGeneratingFeedback}
            className={cn(
              "w-14 h-14 rounded-full flex items-center justify-center transition-all border shadow-md disabled:opacity-50",
              isPaused ? "bg-indigo-600 border-indigo-500 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            )}
            title={isPaused ? "Resume" : "Pause"}
          >
            {isPaused ? <Play size={24} fill="currentColor" /> : <Pause size={24} fill="currentColor" />}
          </button>

          <button
            onClick={handleUserStop}
            disabled={isGeneratingFeedback}
            className="w-12 h-12 rounded-full bg-white border border-slate-200 text-slate-600 flex items-center justify-center hover:bg-red-50 hover:text-red-500 hover:border-red-100 transition-all shadow-sm disabled:opacity-50"
            title="Stop Interview"
          >
            <Square size={20} fill="currentColor" />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex gap-1 h-6 items-center">
            {[...Array(12)].map((_, i) => (
              <motion.div
                key={i}
                animate={{ 
                  height: (isConnected && !isPaused) ? [4, Math.random() * 24 + 4, 4] : 4,
                  backgroundColor: (isConnected && !isPaused) ? (isSpeaking ? "#6366f1" : (isMuted ? "#ef4444" : "#10b981")) : "#cbd5e1"
                }}
                transition={{ 
                  repeat: Infinity, 
                  duration: 0.5 + Math.random() * 0.5,
                  ease: "easeInOut"
                }}
                className="w-1 rounded-full"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper function for class names
function cn(...inputs: any[]) {
  return inputs.filter(Boolean).join(' ');
}
