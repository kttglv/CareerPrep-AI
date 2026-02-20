/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Briefcase, 
  FileText, 
  Mic, 
  Send, 
  User, 
  Bot, 
  CheckCircle, 
  AlertCircle, 
  TrendingUp,
  RefreshCw,
  Clipboard,
  ChevronRight,
  Sparkles,
  ArrowRight,
  Award,
  BookOpen,
  Target,
  Zap,
  History,
  Download,
  Video,
  VideoOff,
  Users,
  MessageSquare,
  Globe,
  Search,
  X,
  Upload,
  Plus,
  Trash2,
  Layout,
  Square
} from 'lucide-react';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { optimizeResume, createInterviewChat, analyzeResumeForInterview, generateSpeech, generateFeedback } from './services/geminiService';
import { LiveInterviewSession } from './services/LiveInterviewSession';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore - Vite specific import
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type AppState = 'landing' | 'interview' | 'resume' | 'community' | 'builder';
type InterviewStep = 'resume-input' | 'analyzing' | 'chat' | 'feedback';

interface ResumeBuilderData {
  personalInfo: { name: string; email: string; phone: string; location: string; linkedin: string };
  education: { school: string; degree: string; date: string; gpa: string }[];
  experience: { company: string; role: string; date: string; description: string }[];
  projects: { name: string; tech: string; description: string }[];
  skills: string;
}

interface Message {
  role: 'user' | 'model';
  text: string;
}

interface ChatMessage {
  senderId: string;
  content: string;
  timestamp: string;
}

interface CommunityUser {
  id: string;
  name: string;
  role: string;
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('landing');
  
  // Resume Optimizer State
  const [rawResume, setRawResume] = useState('');
  const [optimizerFileName, setOptimizerFileName] = useState('');
  const [targetMajor, setTargetMajor] = useState('Computer Science');
  const [optimizedResume, setOptimizedResume] = useState('');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationHistory, setOptimizationHistory] = useState<{major: string, date: string, content: string}[]>([]);

  // Interview State
  const [interviewStep, setInterviewStep] = useState<InterviewStep>('resume-input');
  const [interviewMode, setInterviewMode] = useState<'chat' | 'voice'>('voice');
  const [interviewResume, setInterviewResume] = useState('');
  const [interviewFileName, setInterviewFileName] = useState('');
  const [targetRole, setTargetRole] = useState('Software Engineer');
  const [interviewMessages, setInterviewMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState('');
  const [chat, setChat] = useState<any>(null);
  const [isWaitingForAI, setIsWaitingForAI] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [analysisSummary, setAnalysisSummary] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Community & Messaging State
  const [myId] = useState(() => Math.random().toString(36).substring(7));
  const [myName, setMyName] = useState('Anonymous Student');
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<CommunityUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<CommunityUser | null>(null);
  const [directMessages, setDirectMessages] = useState<ChatMessage[]>([]);
  const [dmInput, setDmInput] = useState('');
  const dmEndRef = useRef<HTMLDivElement>(null);

  // Resume Builder State
  const [builderStep, setBuilderStep] = useState(1);
  const [builderData, setBuilderData] = useState<ResumeBuilderData>({
    personalInfo: { name: '', email: '', phone: '', location: '', linkedin: '' },
    education: [{ school: '', degree: '', date: '', gpa: '' }],
    experience: [{ company: '', role: '', date: '', description: '' }],
    projects: [{ name: '', tech: '', description: '' }],
    skills: ''
  });
  const [isGeneratingFromBuilder, setIsGeneratingFromBuilder] = useState(false);

  // Audio & Voice State
  const audioContextRef = useRef<AudioContext | null>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Initialize Speech Recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setUserInput(transcript);
        setIsListening(false);
        // Auto-submit if in voice mode
        handleSendMessage(transcript);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      setUserInput('');
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const playBase64Audio = async (base64Data: string) => {
    try {
      setIsSpeaking(true);
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      // Ensure context is running (browsers often suspend it)
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      // Gemini TTS returns raw 16-bit PCM at 24kHz
      // We need to convert this to Float32 for the Web Audio API
      const pcm16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(pcm16.length);
      
      for (let i = 0; i < pcm16.length; i++) {
        // Normalize 16-bit signed integer to [-1.0, 1.0]
        float32[i] = pcm16[i] / 32768;
      }

      const audioBuffer = audioContextRef.current.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      source.onended = () => setIsSpeaking(false);
      source.start(0);
    } catch (err) {
      console.error("Error playing audio:", err);
      setIsSpeaking(false);
    }
  };

  // Webcam State
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (isCameraOn && mediaStream && videoRef.current) {
      videoRef.current.srcObject = mediaStream;
    }
  }, [isCameraOn, mediaStream]);

  const toggleCamera = async () => {
    if (isCameraOn) {
      mediaStream?.getTracks().forEach(track => track.stop());
      setMediaStream(null);
      setIsCameraOn(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setMediaStream(stream);
        setIsCameraOn(true);
      } catch (err) {
        console.error("Error accessing camera:", err);
        alert("Could not access camera. Please check permissions.");
      }
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [interviewMessages]);

  useEffect(() => {
    dmEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [directMessages]);

  // WebSocket Connection
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}`);
      
      ws.onopen = () => {
        console.log('Connected to WebSocket');
        ws?.send(JSON.stringify({ type: 'auth', userId: myId }));
        // Register user in DB
        fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: myId, name: myName, role: targetRole })
        });
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'chat') {
          setDirectMessages(prev => [...prev, data]);
        } else if (data.type === 'presence') {
          setOnlineUsers(data.users.filter((u: CommunityUser) => u.id !== myId));
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected, retrying...');
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        ws?.close();
      };

      setSocket(ws);
    };

    connect();
    return () => {
      ws?.close();
      clearTimeout(reconnectTimeout);
    };
  }, [myId, myName, targetRole]);

  // Fetch DM history when selecting a user
  useEffect(() => {
    if (selectedUser) {
      fetch(`/api/messages/${myId}/${selectedUser.id}`)
        .then(res => res.json())
        .then(setDirectMessages);
    }
  }, [selectedUser, myId]);

  const sendDirectMessage = () => {
    if (!dmInput.trim() || !selectedUser || !socket) return;
    
    const msg = {
      type: 'chat',
      senderId: myId,
      receiverId: selectedUser.id,
      content: dmInput
    };
    
    socket.send(JSON.stringify(msg));
    setDirectMessages(prev => [...prev, { 
      senderId: myId, 
      content: dmInput, 
      timestamp: new Date().toISOString() 
    }]);
    setDmInput('');
  };

  // PDF Parsing State
  const [isParsingPdf, setIsParsingPdf] = useState(false);

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: 'optimizer' | 'interview') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      alert('Please upload a PDF file.');
      return;
    }

    setIsParsingPdf(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ 
        data: arrayBuffer,
        cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
        cMapPacked: true,
      });
      
      const pdf = await loadingTask.promise;
      let fullText = '';
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        let lastY: number | undefined;
        let pageText = '';
        
        for (const item of textContent.items as any[]) {
          if (lastY !== undefined && Math.abs(lastY - item.transform[5]) > 5) {
            pageText += '\n';
          }
          pageText += item.str + ' ';
          lastY = item.transform[5];
        }
        
        fullText += pageText + '\n\n';
      }
      
      if (target === 'optimizer') {
        setRawResume(fullText);
        setOptimizerFileName(file.name);
      } else {
        setInterviewResume(fullText);
        setInterviewFileName(file.name);
      }
    } catch (err) {
      console.error('Error parsing PDF:', err);
      alert('Failed to parse PDF. Please try pasting the text instead.');
    } finally {
      setIsParsingPdf(false);
      // Reset input value to allow uploading the same file again
      e.target.value = '';
    }
  };

  const generateResumeFromBuilder = async () => {
    setIsGeneratingFromBuilder(true);
    try {
      const prompt = `Create a professional, ATS-optimized resume based on the following data:
      ${JSON.stringify(builderData, null, 2)}
      
      Format it in clean Markdown with professional headers and bullet points.`;
      
      const result = await optimizeResume(prompt, targetMajor);
      setOptimizedResume(result || '');
      setAppState('resume');
    } catch (error) {
      console.error('Generation failed:', error);
    } finally {
      setIsGeneratingFromBuilder(false);
    }
  };

  const handleOptimize = async () => {
    if (!rawResume.trim()) return;
    setIsOptimizing(true);
    try {
      const result = await optimizeResume(rawResume, targetMajor);
      const optimized = result || '';
      setOptimizedResume(optimized);
      setOptimizationHistory(prev => [
        { major: targetMajor, date: new Date().toLocaleTimeString(), content: optimized },
        ...prev.slice(0, 4)
      ]);
    } catch (error) {
      console.error('Optimization failed:', error);
    } finally {
      setIsOptimizing(false);
    }
  };

  const startInterviewSetup = async () => {
    if (!interviewResume.trim()) return;
    setInterviewStep('analyzing');
    try {
      const summary = await analyzeResumeForInterview(interviewResume, targetRole);
      setAnalysisSummary(summary || '');
      
      const newChat = createInterviewChat(targetRole, interviewResume);
      setChat(newChat);
      
      // Initial message to set context
      const response = await newChat.sendMessage({ 
        message: "I am ready to begin the interview. Please start." 
      });
      
      setInterviewMessages([{ role: 'model', text: response.text || '' }]);
      setInterviewStep('chat');

      // Generate and play speech for initial message
      if (response.text) {
        const audioData = await generateSpeech(response.text);
        if (audioData) playBase64Audio(audioData);
      }
    } catch (error) {
      console.error('Interview setup failed:', error);
      setInterviewStep('resume-input');
    }
  };

  const handleSendMessage = async (overrideText?: string) => {
    const textToSend = overrideText || userInput;
    if (!textToSend.trim() || !chat || isWaitingForAI) return;

    const userMsg = textToSend;
    if (!overrideText) setUserInput('');
    setInterviewMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsWaitingForAI(true);

    try {
      const response = await chat.sendMessage({ message: userMsg });
      const text = response.text || '';
      setInterviewMessages(prev => [...prev, { role: 'model', text }]);
      
      // Generate and play speech
      const audioData = await generateSpeech(text);
      if (audioData) playBase64Audio(audioData);

      if (text.toLowerCase().includes('interview is complete')) {
        setInterviewStep('feedback');
      }
    } catch (error) {
      console.error('Chat failed:', error);
      setInterviewMessages(prev => [...prev, { role: 'model', text: 'Sorry, I encountered an error. Please try again.' }]);
    } finally {
      setIsWaitingForAI(false);
    }
  };

  const resetInterview = () => {
    setInterviewStep('resume-input');
    setInterviewMessages([]);
    setChat(null);
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-slate-900 font-sans selection:bg-indigo-100">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200/60 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div 
            className="flex items-center gap-2 cursor-pointer group"
            onClick={() => setAppState('landing')}
          >
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200 group-hover:scale-105 transition-transform">
              <Sparkles size={24} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">CareerPrep AI</h1>
          </div>
          
          <div className="hidden md:flex bg-slate-100 p-1 rounded-xl">
            <button
              id="nav-interview-btn"
              onClick={() => setAppState('interview')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2",
                appState === 'interview' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Mic size={16} />
              Mock Interview
            </button>
            <button
              id="nav-resume-btn"
              onClick={() => setAppState('resume')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2",
                appState === 'resume' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <FileText size={16} />
              Resume Optimizer
            </button>
            <button
              id="nav-builder-btn"
              onClick={() => setAppState('builder')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2",
                appState === 'builder' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Layout size={16} />
              Resume Builder
            </button>
            <button
              id="nav-community-btn"
              onClick={() => setAppState('community')}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2",
                appState === 'community' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Users size={16} />
              Community
            </button>
          </div>

          <div className="md:hidden">
            <button className="p-2 text-slate-500">
              <History size={20} />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-6 md:p-10">
        <AnimatePresence mode="wait">
          {appState === 'landing' && (
            <motion.div
              key="landing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center text-center py-12 md:py-24 space-y-12"
            >
              <div className="space-y-6 max-w-3xl">
                <motion.div 
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-full text-sm font-semibold mb-4"
                >
                  <Award size={16} />
                  Your AI Career Companion
                </motion.div>
                <h2 className="text-5xl md:text-7xl font-black tracking-tight text-slate-900 leading-[1.1]">
                  Land your dream job with <span className="text-indigo-600">AI Precision.</span>
                </h2>
                <p className="text-xl text-slate-500 leading-relaxed max-w-2xl mx-auto">
                  Master your interviews and optimize your resume for ATS with our specialized AI tools designed for the modern job market.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl">
                <button
                  id="landing-interview-card"
                  onClick={() => setAppState('interview')}
                  className="group relative bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl hover:border-indigo-200 transition-all text-left overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Mic size={120} />
                  </div>
                  <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                    <Mic size={28} />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">Mock Interview</h3>
                  <p className="text-slate-500 mb-6 leading-relaxed">
                    Practice with a specialized AI recruiter. Get real-time questions and a detailed feedback report.
                  </p>
                  <div className="flex items-center gap-2 text-indigo-600 font-bold">
                    Start Practice <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>

                <button
                  id="landing-resume-card"
                  onClick={() => setAppState('resume')}
                  className="group relative bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl hover:border-indigo-200 transition-all text-left overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                    <FileText size={120} />
                  </div>
                  <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                    <FileText size={28} />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">Resume Optimizer</h3>
                  <p className="text-slate-500 mb-6 leading-relaxed">
                    Transform your experience into ATS-optimized bullet points using the Google formula.
                  </p>
                  <div className="flex items-center gap-2 text-emerald-600 font-bold">
                    Optimize Now <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>

                <button
                  id="landing-builder-card"
                  onClick={() => setAppState('builder')}
                  className="group relative bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm hover:shadow-xl hover:border-indigo-200 transition-all text-left overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Layout size={120} />
                  </div>
                  <div className="w-14 h-14 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                    <Layout size={28} />
                  </div>
                  <h3 className="text-2xl font-bold mb-3">Resume Builder</h3>
                  <p className="text-slate-500 mb-6 leading-relaxed">
                    Don't have a resume? Build one from scratch with our step-by-step AI-guided questionnaire.
                  </p>
                  <div className="flex items-center gap-2 text-amber-600 font-bold">
                    Build Resume <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              </div>

              <div className="flex flex-wrap justify-center gap-12 opacity-40 grayscale pt-12">
                <div className="flex items-center gap-2 font-bold text-xl"><Zap size={24} /> Fast</div>
                <div className="flex items-center gap-2 font-bold text-xl"><Target size={24} /> Precise</div>
                <div className="flex items-center gap-2 font-bold text-xl"><BookOpen size={24} /> Educational</div>
              </div>
            </motion.div>
          )}

          {appState === 'interview' && (
            <motion.div
              key="interview"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight">Mock Interview</h2>
                  <p className="text-slate-500">Practice makes perfect. Be ready for your next big break.</p>
                </div>
                {interviewStep !== 'resume-input' && (
                  <button 
                    onClick={resetInterview}
                    className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    <RefreshCw size={16} />
                    Reset Session
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Interview Sidebar */}
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                      <Briefcase className="text-indigo-600" size={20} />
                      Session Info
                    </h3>
                    
                    <div className="space-y-4">
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Target Role</label>
                        <input 
                          type="text" 
                          value={targetRole}
                          onChange={(e) => setTargetRole(e.target.value)}
                          disabled={interviewStep !== 'resume-input'}
                          className="w-full bg-transparent font-semibold text-slate-800 focus:outline-none disabled:opacity-60"
                        />
                      </div>

                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                        <div className="flex items-center justify-between mb-3">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Video Interview</label>
                          <button 
                            onClick={toggleCamera}
                            className={cn(
                              "p-1.5 rounded-lg transition-colors",
                              isCameraOn ? "bg-red-100 text-red-600" : "bg-indigo-100 text-indigo-600"
                            )}
                          >
                            {isCameraOn ? <VideoOff size={14} /> : <Video size={14} />}
                          </button>
                        </div>
                        <div className="aspect-video bg-slate-900 rounded-xl overflow-hidden relative">
                          {!isCameraOn ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 gap-2">
                              <VideoOff size={24} className="opacity-20" />
                              <span className="text-[10px] font-bold uppercase tracking-widest">Camera Off</span>
                            </div>
                          ) : (
                            <video 
                              ref={videoRef} 
                              autoPlay 
                              playsInline 
                              muted 
                              className="w-full h-full object-cover mirror"
                            />
                          )}
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 text-sm text-slate-600">
                          <div className={cn("w-2 h-2 rounded-full", interviewStep === 'resume-input' ? "bg-indigo-600 animate-pulse" : "bg-emerald-500")}></div>
                          <span>Resume Analysis</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-slate-600">
                          <div className={cn("w-2 h-2 rounded-full", interviewStep === 'chat' ? "bg-indigo-600 animate-pulse" : (interviewStep === 'feedback' ? "bg-emerald-500" : "bg-slate-200"))}></div>
                          <span>Mock Interview</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-slate-600">
                          <div className={cn("w-2 h-2 rounded-full", interviewStep === 'feedback' ? "bg-indigo-600 animate-pulse" : "bg-slate-200")}></div>
                          <span>Feedback Report</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {analysisSummary && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-indigo-600 p-6 rounded-3xl text-white shadow-xl shadow-indigo-100"
                    >
                      <Zap size={32} className="mb-4 opacity-80" />
                      <h3 className="text-lg font-bold mb-2">AI Analysis</h3>
                      <p className="text-indigo-100 text-sm leading-relaxed">
                        {analysisSummary}
                      </p>
                    </motion.div>
                  )}
                </div>

                {/* Main Interaction Area */}
                <div className="lg:col-span-2 min-h-[600px] flex flex-col bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                  <AnimatePresence mode="wait">
                    {interviewStep === 'resume-input' && (
                      <motion.div 
                        key="input"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex-1 p-10 flex flex-col items-center justify-center text-center space-y-8"
                      >
                        <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
                          <FileText size={40} />
                        </div>
                        <div className="flex items-center justify-between mb-4 w-full">
                          <div className="text-left">
                            <h3 className="text-2xl font-bold">Resume Content</h3>
                            <p className="text-slate-500 text-sm">Paste your resume or upload a PDF to tailor the interview.</p>
                          </div>
                          <label className="cursor-pointer bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-xl text-sm font-bold transition-all hover:bg-slate-50 shadow-sm flex items-center gap-2">
                            {isParsingPdf ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                            {isParsingPdf ? 'Parsing...' : 'Upload PDF'}
                            <input type="file" accept=".pdf" className="hidden" onChange={(e) => handlePdfUpload(e, 'interview')} />
                          </label>
                        </div>
                        
                        <div className="w-full relative group">
                          {interviewFileName && (
                            <div className="absolute -top-3 left-6 px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold rounded-full shadow-lg z-10 flex items-center gap-1.5 animate-in slide-in-from-bottom-2">
                              <FileText size={10} />
                              {interviewFileName}
                              <button 
                                onClick={() => {
                                  setInterviewFileName('');
                                  setInterviewResume('');
                                }}
                                className="ml-1 hover:text-red-200 transition-colors"
                              >
                                <X size={10} />
                              </button>
                            </div>
                          )}
                          <textarea
                            id="interview-resume-textarea"
                            value={interviewResume}
                            onChange={(e) => {
                              setInterviewResume(e.target.value);
                              if (interviewFileName) setInterviewFileName('');
                            }}
                            placeholder="Paste resume text here or upload a PDF..."
                            className={cn(
                              "w-full h-64 bg-slate-50 border rounded-3xl p-8 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none",
                              interviewFileName ? "border-indigo-200 ring-4 ring-indigo-500/5" : "border-slate-200"
                            )}
                          />
                        </div>
                        
                        <div className="flex items-center gap-6 mt-6">
                          <button
                            onClick={() => setInterviewMode('voice')}
                            className={cn(
                              "flex-1 p-4 rounded-2xl border transition-all flex flex-col items-center gap-2",
                              interviewMode === 'voice' ? "bg-indigo-50 border-indigo-200 text-indigo-600" : "bg-white border-slate-200 text-slate-400 hover:border-slate-300"
                            )}
                          >
                            <Mic size={24} />
                            <span className="text-xs font-bold uppercase tracking-widest">Voice Mode</span>
                          </button>
                          <button
                            onClick={() => setInterviewMode('chat')}
                            className={cn(
                              "flex-1 p-4 rounded-2xl border transition-all flex flex-col items-center gap-2",
                              interviewMode === 'chat' ? "bg-indigo-50 border-indigo-200 text-indigo-600" : "bg-white border-slate-200 text-slate-400 hover:border-slate-300"
                            )}
                          >
                            <MessageSquare size={24} />
                            <span className="text-xs font-bold uppercase tracking-widest">Chat Mode</span>
                          </button>
                        </div>

                        <button
                          id="start-interview-btn"
                          onClick={startInterviewSetup}
                          disabled={!interviewResume.trim()}
                          className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          Analyze & Start Interview
                          <ArrowRight size={20} />
                        </button>
                      </motion.div>
                    )}

                    {interviewStep === 'analyzing' && (
                      <motion.div 
                        key="analyzing"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex-1 flex flex-col items-center justify-center p-10 text-center space-y-6"
                      >
                        <div className="relative">
                          <div className="w-24 h-24 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
                          <div className="absolute inset-0 flex items-center justify-center text-indigo-600">
                            <Bot size={32} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-xl font-bold">Analyzing your background...</h3>
                          <p className="text-slate-500">Preparing tailored behavioral and technical questions.</p>
                        </div>
                      </motion.div>
                    )}

                    {interviewStep === 'chat' && interviewMode === 'voice' && (
                      <LiveInterviewSession 
                        resume={interviewResume} 
                        role={targetRole} 
                        onComplete={(feedback) => {
                          setInterviewMessages(prev => [...prev, { role: 'model', text: feedback }]);
                          setInterviewStep('feedback');
                        }}
                        onStop={resetInterview}
                      />
                    )}

                    {(interviewStep === 'chat' && interviewMode === 'chat' || interviewStep === 'feedback') && (
                      <motion.div 
                        key="chat-or-feedback"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex-1 flex flex-col h-full"
                      >
                        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
                          {interviewMessages.map((msg, i) => (
                            <motion.div
                              key={i}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className={cn(
                                "flex gap-4 max-w-[90%]",
                                msg.role === 'user' ? "ml-auto flex-row-reverse" : "mr-auto"
                              )}
                            >
                              <div className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm",
                                msg.role === 'user' ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-600"
                              )}>
                                {msg.role === 'user' ? <User size={20} /> : <Bot size={20} />}
                              </div>
                              <div className={cn(
                                "p-5 rounded-3xl text-sm leading-relaxed",
                                msg.role === 'user' 
                                  ? "bg-indigo-600 text-white rounded-tr-none" 
                                  : "bg-slate-50 text-slate-800 border border-slate-100 rounded-tl-none"
                              )}>
                                <div className="prose prose-sm max-w-none prose-p:leading-relaxed prose-headings:text-slate-900 prose-strong:text-slate-900">
                                  <Markdown>
                                    {msg.text}
                                  </Markdown>
                                </div>
                              </div>
                            </motion.div>
                          ))}
                          {interviewStep === 'chat' && isWaitingForAI && (
                            <div className="flex gap-4 mr-auto">
                              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 text-slate-600 flex items-center justify-center shadow-sm">
                                <Bot size={20} />
                              </div>
                              <div className="bg-slate-50 p-5 rounded-3xl rounded-tl-none border border-slate-100">
                                <div className="flex gap-1.5">
                                  <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                  <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                  <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                </div>
                              </div>
                            </div>
                          )}
                          {interviewStep === 'chat' && isSpeaking && (
                            <div className="flex gap-4 mr-auto">
                              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shadow-sm">
                                <Mic size={20} className="animate-pulse" />
                              </div>
                              <div className="bg-indigo-50 p-5 rounded-3xl rounded-tl-none border border-indigo-100 flex items-center gap-2">
                                <span className="text-xs font-bold text-indigo-600 uppercase tracking-widest">AI is speaking...</span>
                                <div className="flex gap-1">
                                  <span className="w-1 h-3 bg-indigo-400 rounded-full animate-[bounce_1s_infinite]"></span>
                                  <span className="w-1 h-5 bg-indigo-500 rounded-full animate-[bounce_1.2s_infinite]"></span>
                                  <span className="w-1 h-3 bg-indigo-400 rounded-full animate-[bounce_1.4s_infinite]"></span>
                                </div>
                              </div>
                            </div>
                          )}
                          <div ref={chatEndRef} />
                        </div>
                        
                        {interviewStep === 'chat' && (
                          <div className="p-6 bg-slate-50 border-t border-slate-200">
                            <div className="relative flex items-center gap-3">
                              <button
                                id="interview-mic-btn"
                                onClick={toggleListening}
                                className={cn(
                                  "p-4 rounded-2xl transition-all shadow-md flex items-center justify-center",
                                  isListening 
                                    ? "bg-red-500 text-white animate-pulse shadow-red-100" 
                                    : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
                                )}
                                title={isListening ? "Stop Listening" : "Start Voice Input"}
                              >
                                {isListening ? <Square size={20} fill="currentColor" /> : <Mic size={20} />}
                              </button>
                              
                              <textarea
                                value={userInput}
                                onChange={(e) => setUserInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendMessage();
                                  }
                                }}
                                placeholder={isListening ? "Listening..." : "Type your response or use the mic..."}
                                className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-4 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none min-h-[60px] max-h-[200px] shadow-sm"
                                rows={1}
                              />
                              <button
                                onClick={() => handleSendMessage()}
                                disabled={!userInput.trim() || isWaitingForAI}
                                className="absolute right-3 p-3 bg-indigo-600 text-white hover:bg-indigo-700 rounded-xl transition-all disabled:opacity-50 shadow-md shadow-indigo-100"
                              >
                                <Send size={20} />
                              </button>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-3 text-center font-medium uppercase tracking-widest">
                              {isListening ? "AI is listening to your answer..." : "Shift + Enter for new line • Enter to send • Use mic for voice mode"}
                            </p>
                          </div>
                        )}

                        {interviewStep === 'feedback' && (
                          <div className="p-8 bg-indigo-50 border-t border-indigo-100 flex flex-col items-center gap-4">
                            <div className="flex items-center gap-2 text-indigo-600 font-bold">
                              <Award size={24} />
                              Interview Complete
                            </div>
                            <button 
                              onClick={resetInterview}
                              className="px-8 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                            >
                              Start New Session
                            </button>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}

          {appState === 'community' && (
            <motion.div
              key="community"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight">Student Community</h2>
                  <p className="text-slate-500">Connect with others seeking similar roles and share insights.</p>
                </div>
                <div className="flex items-center gap-3 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                    <User size={20} />
                  </div>
                  <div className="pr-4">
                    <input 
                      id="community-name-input"
                      type="text" 
                      value={myName}
                      onChange={(e) => setMyName(e.target.value)}
                      className="text-sm font-bold text-slate-900 focus:outline-none bg-transparent"
                      placeholder="Your Name"
                    />
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{targetRole}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-[600px]">
                {/* Users List */}
                <div className="lg:col-span-1 bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="p-6 border-b border-slate-100">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                      <input 
                        id="community-search-input"
                        type="text" 
                        placeholder="Search students..."
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                      />
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-hide">
                    {onlineUsers.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-40">
                        <Globe size={32} className="mb-2" />
                        <p className="text-xs font-bold uppercase tracking-widest">No other students online</p>
                      </div>
                    ) : (
                      onlineUsers.map(user => (
                        <button
                          key={user.id}
                          onClick={() => setSelectedUser(user)}
                          className={cn(
                            "w-full flex items-center gap-3 p-4 rounded-2xl transition-all text-left",
                            selectedUser?.id === user.id ? "bg-indigo-50 border-indigo-100" : "hover:bg-slate-50 border-transparent"
                          )}
                        >
                          <div className="w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-slate-600 shadow-sm">
                            <User size={20} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate">{user.name}</p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest truncate">{user.role}</p>
                          </div>
                          <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Messaging Area */}
                <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                  {!selectedUser ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-10 opacity-40">
                      <MessageSquare size={48} className="mb-4" />
                      <h3 className="text-lg font-bold">Select a student</h3>
                      <p className="text-sm max-w-[200px]">Start a conversation with someone seeking the same position.</p>
                    </div>
                  ) : (
                    <>
                      <div className="px-8 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-white border border-slate-200 rounded-lg flex items-center justify-center text-slate-600">
                            <User size={16} />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">{selectedUser.name}</p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Online</p>
                          </div>
                        </div>
                        <button onClick={() => setSelectedUser(null)} className="p-2 text-slate-400 hover:text-slate-600">
                          <X size={20} />
                        </button>
                      </div>
                      
                      <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
                        {directMessages.map((msg, i) => (
                          <div 
                            key={i}
                            className={cn(
                              "flex flex-col max-w-[80%]",
                              msg.senderId === myId ? "ml-auto items-end" : "mr-auto items-start"
                            )}
                          >
                            <div className={cn(
                              "p-4 rounded-2xl text-sm",
                              msg.senderId === myId ? "bg-indigo-600 text-white rounded-tr-none" : "bg-slate-100 text-slate-800 rounded-tl-none"
                            )}>
                              {msg.content}
                            </div>
                            <span className="text-[10px] text-slate-400 mt-1 font-medium">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))}
                        <div ref={dmEndRef} />
                      </div>

                      <div className="p-6 bg-slate-50 border-t border-slate-200">
                        <div className="relative flex items-center gap-3">
                          <input 
                            id="community-message-input"
                            type="text" 
                            value={dmInput}
                            onChange={(e) => setDmInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && sendDirectMessage()}
                            placeholder={`Message ${selectedUser.name}...`}
                            className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-4 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm"
                          />
                          <button
                            id="community-send-btn"
                            onClick={sendDirectMessage}
                            disabled={!dmInput.trim()}
                            className="absolute right-3 p-3 bg-indigo-600 text-white hover:bg-indigo-700 rounded-xl transition-all disabled:opacity-50 shadow-md shadow-indigo-100"
                          >
                            <Send size={20} />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
          {appState === 'builder' && (
            <motion.div
              key="builder"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight">Resume Builder</h2>
                  <p className="text-slate-500">Step-by-step AI-guided resume creation.</p>
                </div>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map(step => (
                    <div 
                      key={step}
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                        builderStep === step ? "bg-indigo-600 text-white scale-110 shadow-lg" : (builderStep > step ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400")
                      )}
                    >
                      {builderStep > step ? <CheckCircle size={14} /> : step}
                    </div>
                  ))}
                </div>
              </div>

              <div className="max-w-3xl mx-auto bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
                {builderStep === 1 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                    <h3 className="text-xl font-bold">Personal Information</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Full Name</label>
                        <input 
                          id="builder-name-input"
                          type="text" 
                          value={builderData.personalInfo.name}
                          onChange={(e) => setBuilderData({...builderData, personalInfo: {...builderData.personalInfo, name: e.target.value}})}
                          className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Email Address</label>
                        <input 
                          type="email" 
                          value={builderData.personalInfo.email}
                          onChange={(e) => setBuilderData({...builderData, personalInfo: {...builderData.personalInfo, email: e.target.value}})}
                          className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Phone Number</label>
                        <input 
                          type="text" 
                          value={builderData.personalInfo.phone}
                          onChange={(e) => setBuilderData({...builderData, personalInfo: {...builderData.personalInfo, phone: e.target.value}})}
                          className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Location</label>
                        <input 
                          type="text" 
                          value={builderData.personalInfo.location}
                          onChange={(e) => setBuilderData({...builderData, personalInfo: {...builderData.personalInfo, location: e.target.value}})}
                          className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                        />
                      </div>
                    </div>
                  </motion.div>
                )}

                {builderStep === 2 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold">Education</h3>
                      <button 
                        onClick={() => setBuilderData({...builderData, education: [...builderData.education, { school: '', degree: '', date: '', gpa: '' }]})}
                        className="text-indigo-600 font-bold text-xs flex items-center gap-1"
                      >
                        <Plus size={14} /> Add School
                      </button>
                    </div>
                    {builderData.education.map((edu, i) => (
                      <div key={i} className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-4 relative">
                        {i > 0 && (
                          <button 
                            onClick={() => setBuilderData({...builderData, education: builderData.education.filter((_, idx) => idx !== i)})}
                            className="absolute top-4 right-4 text-slate-300 hover:text-red-500"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <input 
                            placeholder="School Name" 
                            value={edu.school}
                            onChange={(e) => {
                              const newList = [...builderData.education];
                              newList[i].school = e.target.value;
                              setBuilderData({...builderData, education: newList});
                            }}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm"
                          />
                          <input 
                            placeholder="Degree" 
                            value={edu.degree}
                            onChange={(e) => {
                              const newList = [...builderData.education];
                              newList[i].degree = e.target.value;
                              setBuilderData({...builderData, education: newList});
                            }}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm"
                          />
                          <input 
                            placeholder="Date Range" 
                            value={edu.date}
                            onChange={(e) => {
                              const newList = [...builderData.education];
                              newList[i].date = e.target.value;
                              setBuilderData({...builderData, education: newList});
                            }}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm"
                          />
                          <input 
                            placeholder="GPA (Optional)" 
                            value={edu.gpa}
                            onChange={(e) => {
                              const newList = [...builderData.education];
                              newList[i].gpa = e.target.value;
                              setBuilderData({...builderData, education: newList});
                            }}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm"
                          />
                        </div>
                      </div>
                    ))}
                  </motion.div>
                )}

                {builderStep === 3 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold">Experience</h3>
                      <button 
                        onClick={() => setBuilderData({...builderData, experience: [...builderData.experience, { company: '', role: '', date: '', description: '' }]})}
                        className="text-indigo-600 font-bold text-xs flex items-center gap-1"
                      >
                        <Plus size={14} /> Add Experience
                      </button>
                    </div>
                    {builderData.experience.map((exp, i) => (
                      <div key={i} className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-4 relative">
                        {i > 0 && (
                          <button 
                            onClick={() => setBuilderData({...builderData, experience: builderData.experience.filter((_, idx) => idx !== i)})}
                            className="absolute top-4 right-4 text-slate-300 hover:text-red-500"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <input 
                            placeholder="Company" 
                            value={exp.company}
                            onChange={(e) => {
                              const newList = [...builderData.experience];
                              newList[i].company = e.target.value;
                              setBuilderData({...builderData, experience: newList});
                            }}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm"
                          />
                          <input 
                            placeholder="Role" 
                            value={exp.role}
                            onChange={(e) => {
                              const newList = [...builderData.experience];
                              newList[i].role = e.target.value;
                              setBuilderData({...builderData, experience: newList});
                            }}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm"
                          />
                          <input 
                            placeholder="Date Range" 
                            value={exp.date}
                            onChange={(e) => {
                              const newList = [...builderData.experience];
                              newList[i].date = e.target.value;
                              setBuilderData({...builderData, experience: newList});
                            }}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm"
                          />
                        </div>
                        <textarea 
                          placeholder="Description of your responsibilities and achievements..." 
                          value={exp.description}
                          onChange={(e) => {
                            const newList = [...builderData.experience];
                            newList[i].description = e.target.value;
                            setBuilderData({...builderData, experience: newList});
                          }}
                          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm h-24 resize-none"
                        />
                      </div>
                    ))}
                  </motion.div>
                )}

                {builderStep === 4 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-bold">Projects</h3>
                      <button 
                        onClick={() => setBuilderData({...builderData, projects: [...builderData.projects, { name: '', tech: '', description: '' }]})}
                        className="text-indigo-600 font-bold text-xs flex items-center gap-1"
                      >
                        <Plus size={14} /> Add Project
                      </button>
                    </div>
                    {builderData.projects.map((proj, i) => (
                      <div key={i} className="p-6 bg-slate-50 rounded-2xl border border-slate-100 space-y-4 relative">
                        {i > 0 && (
                          <button 
                            onClick={() => setBuilderData({...builderData, projects: builderData.projects.filter((_, idx) => idx !== i)})}
                            className="absolute top-4 right-4 text-slate-300 hover:text-red-500"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <input 
                            placeholder="Project Name" 
                            value={proj.name}
                            onChange={(e) => {
                              const newList = [...builderData.projects];
                              newList[i].name = e.target.value;
                              setBuilderData({...builderData, projects: newList});
                            }}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm"
                          />
                          <input 
                            placeholder="Technologies Used" 
                            value={proj.tech}
                            onChange={(e) => {
                              const newList = [...builderData.projects];
                              newList[i].tech = e.target.value;
                              setBuilderData({...builderData, projects: newList});
                            }}
                            className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm"
                          />
                        </div>
                        <textarea 
                          placeholder="What did you build and what was the outcome?" 
                          value={proj.description}
                          onChange={(e) => {
                            const newList = [...builderData.projects];
                            newList[i].description = e.target.value;
                            setBuilderData({...builderData, projects: newList});
                          }}
                          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm h-24 resize-none"
                        />
                      </div>
                    ))}
                  </motion.div>
                )}

                {builderStep === 5 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                    <h3 className="text-xl font-bold">Skills & Finishing Touches</h3>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Skills (Comma separated)</label>
                      <textarea 
                        placeholder="React, TypeScript, Python, Project Management, Public Speaking..." 
                        value={builderData.skills}
                        onChange={(e) => setBuilderData({...builderData, skills: e.target.value})}
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm h-32 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/10"
                      />
                    </div>
                    <div className="p-6 bg-indigo-50 rounded-2xl border border-indigo-100 flex items-start gap-4">
                      <Sparkles size={24} className="text-indigo-600 flex-shrink-0 mt-1" />
                      <div>
                        <h4 className="font-bold text-indigo-900">AI Enhancement Ready</h4>
                        <p className="text-sm text-indigo-700 mt-1">Our AI will take these details and craft a high-impact, ATS-optimized resume for you.</p>
                      </div>
                    </div>
                  </motion.div>
                )}

                <div className="flex items-center justify-between pt-8 border-t border-slate-100">
                  <button 
                    id="builder-back-btn"
                    onClick={() => setBuilderStep(prev => Math.max(1, prev - 1))}
                    disabled={builderStep === 1}
                    className="px-6 py-2 text-sm font-bold text-slate-400 hover:text-slate-600 disabled:opacity-30"
                  >
                    Back
                  </button>
                  {builderStep < 5 ? (
                    <button 
                      id="builder-next-btn"
                      onClick={() => setBuilderStep(prev => prev + 1)}
                      className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2"
                    >
                      Next Step <ArrowRight size={18} />
                    </button>
                  ) : (
                    <button 
                      id="builder-generate-btn"
                      onClick={generateResumeFromBuilder}
                      disabled={isGeneratingFromBuilder}
                      className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center gap-2 disabled:opacity-50"
                    >
                      {isGeneratingFromBuilder ? <RefreshCw size={18} className="animate-spin" /> : <Sparkles size={18} />}
                      Generate Resume
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
          {appState === 'resume' && (
            <motion.div
              key="resume"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight">Resume Optimizer</h2>
                  <p className="text-slate-500">Beat the ATS bots with high-impact, quantified achievements.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Input Section */}
                <div className="space-y-6">
                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="text-left">
                        <h3 className="text-lg font-bold flex items-center gap-2">
                          <FileText className="text-indigo-600" size={20} />
                          Experience Details
                        </h3>
                        <p className="text-slate-500 text-xs">Paste your resume or upload a PDF to optimize.</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <label className="cursor-pointer bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-2">
                          {isParsingPdf ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                          {isParsingPdf ? 'Parsing...' : 'Upload PDF'}
                          <input type="file" accept=".pdf" className="hidden" onChange={(e) => handlePdfUpload(e, 'optimizer')} />
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Target Major</span>
                          <select
                            value={targetMajor}
                            onChange={(e) => setTargetMajor(e.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          >
                            <option>Computer Science</option>
                            <option>Finance</option>
                            <option>Marketing</option>
                            <option>Engineering</option>
                            <option>Data Science</option>
                            <option>Product Management</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    
                    <div className="w-full relative group">
                      {optimizerFileName && (
                        <div className="absolute -top-3 left-6 px-3 py-1 bg-indigo-600 text-white text-[10px] font-bold rounded-full shadow-lg z-10 flex items-center gap-1.5 animate-in slide-in-from-bottom-2">
                          <FileText size={10} />
                          {optimizerFileName}
                          <button 
                            onClick={() => {
                              setOptimizerFileName('');
                              setRawResume('');
                            }}
                            className="ml-1 hover:text-red-200 transition-colors"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      )}
                      <textarea
                        id="optimizer-resume-textarea"
                        value={rawResume}
                        onChange={(e) => {
                          setRawResume(e.target.value);
                          if (optimizerFileName) setOptimizerFileName('');
                        }}
                        placeholder="Paste your current resume or raw experience here... (e.g., 'I worked at a cafe and managed the register and inventory')"
                        className={cn(
                          "w-full h-96 bg-slate-50 border rounded-3xl p-8 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all resize-none",
                          optimizerFileName ? "border-indigo-200 ring-4 ring-indigo-500/5" : "border-slate-200"
                        )}
                      />
                    </div>
                    
                    <button
                      id="optimize-resume-btn"
                      onClick={handleOptimize}
                      disabled={isOptimizing || !rawResume.trim()}
                      className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-3 disabled:opacity-50"
                    >
                      {isOptimizing ? (
                        <>
                          <RefreshCw size={24} className="animate-spin" />
                          Analyzing & Rewriting...
                        </>
                      ) : (
                        <>
                          <Sparkles size={24} />
                          Optimize for ATS
                        </>
                      )}
                    </button>
                  </div>

                  {optimizationHistory.length > 0 && (
                    <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm">
                      <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                        <History size={14} />
                        Recent Optimizations
                      </h4>
                      <div className="space-y-3">
                        {optimizationHistory.map((item, i) => (
                          <button 
                            key={i}
                            onClick={() => setOptimizedResume(item.content)}
                            className="w-full flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl transition-colors text-left border border-transparent hover:border-slate-100"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center">
                                <FileText size={16} />
                              </div>
                              <div>
                                <p className="text-sm font-bold">{item.major}</p>
                                <p className="text-[10px] text-slate-400">{item.date}</p>
                              </div>
                            </div>
                            <ChevronRight size={16} className="text-slate-300" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Output Section */}
                <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full min-h-[600px]">
                  <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Optimized Result</h3>
                    {optimizedResume && (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(optimizedResume);
                            alert('Copied to clipboard!');
                          }}
                          className="bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-xl transition-all flex items-center gap-2 text-xs font-bold shadow-sm"
                        >
                          <Clipboard size={14} />
                          Copy
                        </button>
                        <button 
                          className="bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 rounded-xl transition-all flex items-center gap-2 text-xs font-bold shadow-md shadow-indigo-100"
                        >
                          <Download size={14} />
                          Export
                        </button>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 p-10 overflow-y-auto bg-white scrollbar-hide">
                    {optimizedResume ? (
                      <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="prose prose-slate prose-sm max-w-none prose-p:leading-relaxed prose-headings:text-slate-900 prose-strong:text-slate-900"
                      >
                        <Markdown>{optimizedResume}</Markdown>
                      </motion.div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center space-y-6 opacity-40">
                        <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center text-slate-300">
                          <Sparkles size={48} />
                        </div>
                        <div className="space-y-2">
                          <p className="text-lg font-bold">Ready to shine?</p>
                          <p className="text-sm max-w-[200px]">Your optimized, high-impact resume will appear here.</p>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {optimizedResume && (
                    <div className="p-6 bg-amber-50 border-t border-amber-100 flex items-start gap-4">
                      <div className="w-8 h-8 bg-amber-100 text-amber-600 rounded-lg flex items-center justify-center flex-shrink-0">
                        <AlertCircle size={18} />
                      </div>
                      <p className="text-xs text-amber-800 leading-relaxed">
                        <strong className="block mb-1">Important Note:</strong>
                        Placeholders like [X%] or [Amount] were added where data was missing. Be sure to fill these in with your actual metrics before applying!
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-6 py-16 border-t border-slate-200 mt-24">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          <div className="col-span-1 md:col-span-2 space-y-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
                <Sparkles size={18} />
              </div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900">CareerPrep AI</h1>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed max-w-sm">
              Empowering the next generation of professionals with AI-driven career tools. Built for students, by career experts.
            </p>
          </div>
          <div className="space-y-4">
            <h4 className="text-sm font-bold uppercase tracking-widest text-slate-900">Product</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><button onClick={() => setAppState('interview')} className="hover:text-indigo-600 transition-colors">Mock Interview</button></li>
              <li><button onClick={() => setAppState('resume')} className="hover:text-indigo-600 transition-colors">Resume Optimizer</button></li>
              <li><a href="#" className="hover:text-indigo-600 transition-colors">Pricing</a></li>
            </ul>
          </div>
          <div className="space-y-4">
            <h4 className="text-sm font-bold uppercase tracking-widest text-slate-900">Resources</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><a href="#" className="hover:text-indigo-600 transition-colors">Career Blog</a></li>
              <li><a href="#" className="hover:text-indigo-600 transition-colors">Interview Tips</a></li>
              <li><a href="#" className="hover:text-indigo-600 transition-colors">ATS Guide</a></li>
            </ul>
          </div>
        </div>
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 pt-12 border-t border-slate-100">
          <div className="flex items-center gap-2 opacity-30">
            <span className="text-xs font-bold uppercase tracking-widest">© 2026 CareerPrep AI • All Rights Reserved</span>
          </div>
          <div className="flex items-center gap-8 text-xs font-bold text-slate-400 uppercase tracking-widest">
            <a href="#" className="hover:text-indigo-600 transition-colors">Privacy</a>
            <a href="#" className="hover:text-indigo-600 transition-colors">Terms</a>
            <a href="#" className="hover:text-indigo-600 transition-colors">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
