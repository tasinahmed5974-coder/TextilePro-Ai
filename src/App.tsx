/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  MessageSquare, 
  Mic, 
  Camera, 
  Image as ImageIcon, 
  FileUp, 
  Send, 
  Copy, 
  Edit2, 
  X,
  Loader2,
  Volume2,
  VolumeX,
  Sparkles,
  Plus,
  ArrowUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { SYSTEM_INSTRUCTION, Message } from './constants';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const AnimatedText = ({ text, className, delay = 0, highlightWords = [] }: { text: string, className?: string, delay?: number, highlightWords?: string[] }) => {
  const words = text.split(" ");
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: { staggerChildren: 0.08, delayChildren: delay }
        }
      }}
      initial="hidden"
      animate="visible"
      className={className}
    >
      {words.map((word, i) => {
        const cleanWord = word.replace(/[.,!?]/g, '');
        const isHighlight = highlightWords.includes(cleanWord);
        return (
          <motion.span
            key={i}
            variants={{
              hidden: { opacity: 0, y: 15, filter: "blur(8px)", scale: 0.9 },
              visible: { opacity: 1, y: 0, filter: "blur(0px)", scale: 1, transition: { type: "spring", stiffness: 100 } }
            }}
            className={cn(
              "inline-block mr-1.5", 
              isHighlight ? "text-teal-400 font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" : "text-white"
            )}
          >
            {word}
          </motion.span>
        );
      })}
    </motion.div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'voice'>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [inputLanguage, setInputLanguage] = useState<'en-US' | 'bn-BD'>('en-US');
  const [isListening, setIsListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isImageGenMode, setIsImageGenMode] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{ name: string, content: string } | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const genericFileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recognitionRef = useRef<any>(null);

  const startSpeechToText = () => {
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser. Please use Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = inputLanguage;
    recognition.continuous = true;
    recognition.interimResults = true;

    let lastRecognized = '';

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      if (event.error === 'not-allowed') {
        alert("Microphone access is denied. Please allow microphone permissions in your browser.");
      }
      setIsListening(false);
    };

    recognition.onresult = (event: any) => {
      let currentSessionTranscript = '';
      
      for (let i = 0; i < event.results.length; ++i) {
        currentSessionTranscript += event.results[i][0].transcript;
      }
      
      const cleanSessionText = currentSessionTranscript.replace(/\s+/g, ' ').trim();
      
      setInputText((prevText) => {
        let baseText = prevText;
        
        if (lastRecognized && baseText.endsWith(lastRecognized)) {
          baseText = baseText.slice(0, -lastRecognized.length);
        }
        
        const separator = baseText && !baseText.endsWith(' ') && cleanSessionText ? ' ' : '';
        const newRecognized = cleanSessionText ? separator + cleanSessionText : '';
        
        lastRecognized = newRecognized;
        return baseText + newRecognized;
      });
    };

    try {
      recognition.start();
    } catch (e) {
      console.error("Speech recognition start error", e);
      setIsListening(false);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (text: string, image?: string) => {
    if (!text.trim() && !image && !uploadedFile) return;

    let fullText = text;
    if (uploadedFile) {
      fullText = `[Attached File: ${uploadedFile.name}]\nContent:\n${uploadedFile.content}\n\nUser Question: ${text}`;
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: text,
      image: image
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setPreviewImage(null);
    setUploadedFile(null);
    setIsLoading(true);

    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("API Key is missing. Please configure GEMINI_API_KEY in the Secrets panel.");
      }

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      if (isImageGenMode) {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: [{ text: text }],
          config: {
            imageConfig: {
              aspectRatio: "1:1",
            }
          }
        });

        let generatedImageUrl = "";
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            generatedImageUrl = `data:image/png;base64,${part.inlineData.data}`;
            break;
          }
        }

        const aiMsg: Message = {
          id: (Date.now() + 1).toString(),
          role: 'model',
          text: response.text || "Here is the generated image for your request:",
          image: generatedImageUrl
        };
        setMessages(prev => [...prev, aiMsg]);
        setIsImageGenMode(false); // Reset mode after generation
        return;
      }

      // Include last 10 messages for better context
      const history = messages.slice(-10).map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      }));

      const currentContent = image ? {
        role: 'user',
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: image.split(',')[1] } },
          { text: fullText || "Analyze this image in the context of textile/garments industry." }
        ]
      } : {
        role: 'user',
        parts: [{ text: fullText }]
      };

      const responseStream = await ai.models.generateContentStream({
        model: "gemini-3-flash-preview",
        contents: [...history, currentContent],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.7,
        }
      });
      
      const aiMsgId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, {
        id: aiMsgId,
        role: 'model',
        text: ""
      }]);

      for await (const chunk of responseStream) {
        const c = chunk as any;
        if (c.text) {
          setMessages(prev => prev.map(m => 
            m.id === aiMsgId ? { ...m, text: m.text + c.text } : m
          ));
        }
      }
    } catch (error) {
      console.error("AI Error:", error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        text: "Error: Failed to connect to TextilePro AI. Please check your connection."
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      if (file.type.startsWith('image/')) {
        reader.onloadend = () => {
          setPreviewImage(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onloadend = () => {
          setUploadedFile({
            name: file.name,
            content: reader.result as string
          });
        };
        reader.readAsText(file);
      }
    }
  };

  const openCamera = async () => {
    setIsCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera error:", err);
      setIsCameraOpen(false);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      canvasRef.current.width = videoRef.current.videoWidth;
      canvasRef.current.height = videoRef.current.videoHeight;
      context?.drawImage(videoRef.current, 0, 0);
      const dataUrl = canvasRef.current.toDataURL('image/jpeg');
      setPreviewImage(dataUrl);
      closeCamera();
    }
  };

  const closeCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream;
    stream?.getTracks().forEach(track => track.stop());
    setIsCameraOpen(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-col h-screen bg-black text-gray-100 font-sans selection:bg-teal-500/30">
      {/* Navbar */}
      <nav className="flex items-end justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-white/10 backdrop-blur-md bg-black/50 sticky top-0 z-50">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-teal-600/20 shrink-0">
            <span className="font-bold text-lg sm:text-xl text-white">T</span>
          </div>
          <div className="flex flex-col justify-center">
            <h1 className="font-bold text-base sm:text-lg tracking-tight text-white whitespace-nowrap">TextilePro AI</h1>
            <p className="text-[8px] sm:text-[10px] uppercase tracking-widest text-teal-400 font-semibold leading-none mt-0.5">Expert Consultant</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex bg-white/5 p-0.5 sm:p-1 rounded-full border border-white/10 mb-0.5 sm:mb-0">
            <button 
              onClick={() => setActiveTab('chat')}
              className={cn(
                "flex items-center gap-1 sm:gap-2 px-2.5 sm:px-4 py-1 sm:py-1.5 rounded-full transition-all duration-300",
                activeTab === 'chat' ? "bg-teal-600 text-white shadow-md" : "text-gray-400 hover:text-white"
              )}
            >
              <MessageSquare size={14} className="sm:w-4 sm:h-4" />
              <span className="text-[11px] sm:text-sm font-medium">Chat</span>
            </button>
            <button 
              onClick={() => setActiveTab('voice')}
              className={cn(
                "flex items-center gap-1 sm:gap-2 px-2.5 sm:px-4 py-1 sm:py-1.5 rounded-full transition-all duration-300",
                activeTab === 'voice' ? "bg-teal-600 text-white shadow-md" : "text-gray-400 hover:text-white"
              )}
            >
              <Mic size={14} className="sm:w-4 sm:h-4" />
              <span className="text-[11px] sm:text-sm font-medium">Voice</span>
            </button>
          </div>
          <button
            onClick={() => {
              setMessages([]);
              setInputText('');
              setPreviewImage(null);
              setUploadedFile(null);
            }}
            className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-teal-600/10 hover:bg-teal-600/20 text-teal-400 border border-teal-500/30 rounded-full transition-all duration-300 text-[11px] sm:text-sm font-medium"
          >
            <Plus size={14} className="sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">New Chat</span>
          </button>
        </div>
      </nav>

      <main className="flex-1 overflow-hidden relative flex flex-col bg-[#050505]">
        {activeTab === 'chat' ? (
          <>
            {/* Chat Area */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth"
            >
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
                  <div className="w-20 h-20 bg-teal-600/10 rounded-3xl flex items-center justify-center mb-4">
                    <MessageSquare size={40} className="text-teal-500" />
                  </div>
                  <h2 className="text-3xl font-extrabold text-white mb-6">Welcome to TextilePro AI</h2>
                  <div className="space-y-4">
                    <AnimatedText 
                      text="Hello! I am TextilePro AI, your personal expert consultant for Textile Engineering and Garments Production."
                      className="text-lg leading-relaxed"
                    />
                    <AnimatedText 
                      text="I was created by Tasin Ahmed to assist you with everything from spinning, weaving, and dyeing to apparel quality control and costing. How can I help you today?"
                      className="text-base leading-relaxed"
                      delay={1.5}
                      highlightWords={["Tasin", "Ahmed"]}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 w-full mt-8">
                    {['Dyeing Process', 'Fabric Defects', 'Costing Tips', 'Washing Types'].map(tip => (
                      <button 
                        key={tip}
                        onClick={() => handleSendMessage(`Tell me about ${tip}`)}
                        className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs font-medium hover:bg-teal-600/20 hover:border-teal-500/50 transition-all text-left"
                      >
                        {tip}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg) => (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={msg.id}
                  className={cn(
                    "flex flex-col max-w-[85%]",
                    msg.role === 'user' ? "ml-auto items-end" : "mr-auto items-start"
                  )}
                >
                  <div className={cn(
                    "p-4 rounded-2xl shadow-sm",
                    msg.role === 'user' 
                      ? "bg-teal-600/10 border border-teal-500/30 text-white rounded-tr-none backdrop-blur-md" 
                      : "bg-white/5 border border-white/10 text-gray-200 rounded-tl-none backdrop-blur-sm"
                  )}>
                    {msg.image && (
                      <img 
                        src={msg.image} 
                        alt="Uploaded" 
                        className="max-w-full rounded-lg mb-3 border border-white/20"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 px-1">
                    <button 
                      onClick={() => copyToClipboard(msg.text)}
                      className="p-1.5 rounded-md hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
                      title="Copy response"
                    >
                      <Copy size={14} />
                    </button>
                    {msg.role === 'user' && (
                      <button 
                        onClick={() => setInputText(msg.text)}
                        className="p-1.5 rounded-md hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
                        title="Edit prompt"
                      >
                        <Edit2 size={14} />
                      </button>
                    )}
                  </div>
                </motion.div>
              ))}
              {isLoading && (
                <div className="flex items-center gap-3 text-teal-400">
                  <Loader2 size={18} className="animate-spin" />
                  <span className="text-xs font-medium uppercase tracking-wider">Analyzing...</span>
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="p-3 sm:p-6 border-t border-white/10 bg-black/80 backdrop-blur-xl">
              <div className="max-w-4xl mx-auto space-y-3 sm:space-y-4">
                <AnimatePresence>
                  <div className="flex gap-3 flex-wrap">
                    {previewImage && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="relative inline-block"
                      >
                        <img 
                          src={previewImage} 
                          alt="Preview" 
                          className="h-24 w-24 object-cover rounded-xl border-2 border-teal-500 shadow-lg"
                          referrerPolicy="no-referrer"
                        />
                        <button 
                          onClick={() => setPreviewImage(null)}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </motion.div>
                    )}
                    {uploadedFile && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        className="relative inline-block"
                      >
                        <div className="h-24 w-40 bg-white/5 border-2 border-teal-500 rounded-xl flex flex-col items-center justify-center p-3 text-center shadow-lg">
                          <FileUp size={24} className="text-teal-500 mb-1" />
                          <p className="text-[10px] text-gray-300 truncate w-full font-medium">{uploadedFile.name}</p>
                        </div>
                        <button 
                          onClick={() => setUploadedFile(null)}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </motion.div>
                    )}
                  </div>
                </AnimatePresence>

                <div className="relative flex items-end gap-2 sm:gap-3">
                  <div className="flex-1 bg-teal-600/10 border border-teal-500/30 backdrop-blur-md rounded-2xl focus-within:border-teal-500/60 focus-within:bg-teal-600/20 transition-all duration-300 flex items-end p-2 sm:p-3 relative">
                    
                    {/* Mobile Menu Toggle */}
                    <div className="sm:hidden relative">
                      <button 
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        className="p-2 rounded-xl text-teal-500/70 hover:text-teal-300 hover:bg-teal-500/20 transition-all"
                      >
                        <Plus size={20} className={cn("transition-transform", isMobileMenuOpen && "rotate-45")} />
                      </button>
                      
                      <AnimatePresence>
                        {isMobileMenuOpen && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            className="absolute bottom-full left-0 mb-2 bg-[#0a0a0a] border border-teal-500/30 rounded-xl p-2 flex flex-col gap-2 shadow-xl shadow-teal-900/20 z-50 min-w-[180px]"
                          >
                            <div className="flex bg-teal-950/50 border border-teal-500/20 rounded-lg p-0.5">
                              <button 
                                onClick={() => { setInputLanguage('en-US'); setIsMobileMenuOpen(false); }}
                                className={cn(
                                  "px-3 py-1.5 text-xs font-bold rounded-md transition-all flex-1",
                                  inputLanguage === 'en-US' ? "bg-teal-600 text-white" : "text-teal-500/70 hover:text-teal-300"
                                )}
                              >
                                EN
                              </button>
                              <button 
                                onClick={() => { setInputLanguage('bn-BD'); setIsMobileMenuOpen(false); }}
                                className={cn(
                                  "px-3 py-1.5 text-xs font-bold rounded-md transition-all flex-1",
                                  inputLanguage === 'bn-BD' ? "bg-teal-600 text-white" : "text-teal-500/70 hover:text-teal-300"
                                )}
                              >
                                BN
                              </button>
                            </div>
                            <button onClick={() => { startSpeechToText(); setIsMobileMenuOpen(false); }} className="flex items-center gap-2 p-2 rounded-lg hover:bg-teal-500/20 text-teal-100/80 text-sm transition-colors">
                              <Mic size={16} className={isListening ? "text-red-500 animate-pulse" : "text-teal-500"} /> Voice Input
                            </button>
                            <button onClick={() => { setIsImageGenMode(!isImageGenMode); setIsMobileMenuOpen(false); }} className="flex items-center gap-2 p-2 rounded-lg hover:bg-teal-500/20 text-teal-100/80 text-sm transition-colors">
                              <Sparkles size={16} className={isImageGenMode ? "text-teal-400" : "text-teal-500"} /> Generate Image
                            </button>
                            <button onClick={() => { fileInputRef.current?.click(); setIsMobileMenuOpen(false); }} className="flex items-center gap-2 p-2 rounded-lg hover:bg-teal-500/20 text-teal-100/80 text-sm transition-colors">
                              <ImageIcon size={16} className="text-teal-500" /> Upload Image
                            </button>
                            <button onClick={() => { openCamera(); setIsMobileMenuOpen(false); }} className="flex items-center gap-2 p-2 rounded-lg hover:bg-teal-500/20 text-teal-100/80 text-sm transition-colors">
                              <Camera size={16} className="text-teal-500" /> Use Camera
                            </button>
                            <button onClick={() => { genericFileInputRef.current?.click(); setIsMobileMenuOpen(false); }} className="flex items-center gap-2 p-2 rounded-lg hover:bg-teal-500/20 text-teal-100/80 text-sm transition-colors">
                              <FileUp size={16} className="text-teal-500" /> Upload File
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <textarea 
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage(inputText, previewImage || undefined);
                        }
                      }}
                      placeholder={isImageGenMode ? "Describe the image you want to generate..." : "Ask TextilePro AI anything..."}
                      className="flex-1 bg-transparent px-3 py-2 text-sm text-white placeholder:text-teal-100/40 focus:outline-none resize-none min-h-[40px] max-h-40"
                      rows={1}
                    />

                    {/* Desktop Icons */}
                    <div className="hidden sm:flex items-center gap-1 pl-2 border-l border-teal-500/20">
                      <div className="flex bg-teal-950/50 rounded-lg p-0.5 mr-1 border border-teal-500/20">
                        <button 
                          onClick={() => setInputLanguage('en-US')}
                          className={cn(
                            "px-2 py-1 text-[10px] font-bold rounded-md transition-all",
                            inputLanguage === 'en-US' ? "bg-teal-600 text-white" : "text-teal-500/70 hover:text-teal-300"
                          )}
                        >
                          EN
                        </button>
                        <button 
                          onClick={() => setInputLanguage('bn-BD')}
                          className={cn(
                            "px-2 py-1 text-[10px] font-bold rounded-md transition-all",
                            inputLanguage === 'bn-BD' ? "bg-teal-600 text-white" : "text-teal-500/70 hover:text-teal-300"
                          )}
                        >
                          BN
                        </button>
                      </div>
                      <button 
                        onClick={startSpeechToText}
                        className={cn(
                          "p-2 rounded-xl transition-all",
                          isListening ? "bg-red-500/20 text-red-500 animate-pulse" : "hover:bg-teal-500/20 text-teal-500/70 hover:text-teal-300"
                        )}
                        title="Speak to type"
                      >
                        <Mic size={18} />
                      </button>
                      <button 
                        onClick={() => setIsImageGenMode(!isImageGenMode)}
                        className={cn(
                          "p-2 rounded-xl transition-all",
                          isImageGenMode ? "bg-teal-500 text-white shadow-lg shadow-teal-500/30" : "hover:bg-teal-500/20 text-teal-500/70 hover:text-teal-300"
                        )}
                        title="Generate Image"
                      >
                        <Sparkles size={18} />
                      </button>
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="p-2 rounded-xl hover:bg-teal-500/20 text-teal-500/70 hover:text-teal-300 transition-all"
                        title="Upload Image"
                      >
                        <ImageIcon size={18} />
                      </button>
                      <button 
                        onClick={openCamera}
                        className="p-2 rounded-xl hover:bg-teal-500/20 text-teal-500/70 hover:text-teal-300 transition-all"
                        title="Use Camera"
                      >
                        <Camera size={18} />
                      </button>
                      <button 
                        onClick={() => genericFileInputRef.current?.click()}
                        className="p-2 rounded-xl hover:bg-teal-500/20 text-teal-500/70 hover:text-teal-300 transition-all"
                        title="Upload File"
                      >
                        <FileUp size={18} />
                      </button>
                    </div>
                    
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileUpload} 
                      accept="image/*" 
                      className="hidden" 
                    />
                    <input 
                      type="file" 
                      ref={genericFileInputRef} 
                      onChange={handleFileUpload} 
                      accept=".txt,.csv,.json,.md" 
                      className="hidden" 
                    />
                  </div>
                  
                  <button 
                    onClick={() => handleSendMessage(inputText, previewImage || undefined)}
                    disabled={isLoading || (!inputText.trim() && !previewImage && !uploadedFile)}
                    className="h-[56px] w-[56px] shrink-0 bg-teal-600 rounded-2xl flex items-center justify-center shadow-lg shadow-teal-600/20 hover:bg-teal-500 disabled:opacity-50 disabled:hover:bg-teal-600 transition-all active:scale-95 group"
                  >
                    <ArrowUp size={24} className="text-white group-hover:-translate-y-1 transition-transform" />
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <VoiceInterface />
        )}
      </main>

      {/* Camera Modal */}
      <AnimatePresence>
        {isCameraOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-6"
          >
            <div className="relative w-full max-w-2xl aspect-video bg-[#0a0a0a] rounded-3xl overflow-hidden shadow-2xl border border-white/10">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-6">
                <button 
                  onClick={closeCamera}
                  className="w-14 h-14 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-white/20 transition-all"
                >
                  <X size={24} />
                </button>
                <button 
                  onClick={capturePhoto}
                  className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-all"
                >
                  <div className="w-16 h-16 border-4 border-[#0a0a0a] rounded-full" />
                </button>
              </div>
            </div>
            <canvas ref={canvasRef} className="hidden" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

import { useLiveAPI } from './hooks/useLiveAPI';

function VoiceInterface() {
  const { isConnected, isConnecting, error, voiceName, setVoiceName, connect, disconnect } = useLiveAPI();
  const [isMuted, setIsMuted] = useState(false);

  const toggleConnection = () => {
    if (isConnected) {
      disconnect();
    } else {
      connect();
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-8">
      <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10 mb-4">
        <button 
          onClick={() => setVoiceName('Fenrir')}
          disabled={isConnected || isConnecting}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-bold transition-all",
            voiceName === 'Fenrir' ? "bg-teal-600 text-white shadow-lg" : "text-gray-400 hover:text-white"
          )}
        >
          Male Voice
        </button>
        <button 
          onClick={() => setVoiceName('Kore')}
          disabled={isConnected || isConnecting}
          className={cn(
            "px-6 py-2 rounded-xl text-sm font-bold transition-all",
            voiceName === 'Kore' ? "bg-teal-600 text-white shadow-lg" : "text-gray-400 hover:text-white"
          )}
        >
          Female Voice
        </button>
      </div>

      <div className="relative">
        <div className={cn(
          "w-48 h-48 rounded-full flex items-center justify-center transition-all duration-1000",
          isConnected ? "bg-teal-600/20 animate-pulse" : "bg-white/5"
        )}>
          <div className={cn(
            "w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl",
            isConnected ? "bg-teal-600 shadow-teal-600/40" : "bg-[#0a0a0a]"
          )}>
            {isConnecting ? (
              <Loader2 size={40} className="animate-spin text-white" />
            ) : (
              <div className="relative w-full h-full p-2 flex items-center justify-center">
                <Mic 
                  size={isConnected ? 64 : 48} 
                  className={cn(
                    "transition-all duration-500",
                    isConnected ? "text-white scale-110" : "text-white/50"
                  )} 
                />
              </div>
            )}
          </div>
          
          {isConnected && (
            <>
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="absolute inset-0 rounded-full border-2 border-teal-500/50"
                  animate={{
                    scale: [1, 1.8],
                    opacity: [0.8, 0],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    delay: i * 0.6,
                    ease: "easeOut",
                  }}
                />
              ))}
            </>
          )}
        </div>
      </div>

      <div className="text-center space-y-2 max-w-md -mt-2">
        <h2 className="text-2xl font-bold text-white">
          {isConnected ? "TextilePro AI is Listening" : isConnecting ? "Establishing Connection..." : "Voice Consultant"}
        </h2>
        <p className="text-gray-400 text-sm">
          {error ? (
            <span className="text-red-400">{error}</span>
          ) : isConnected 
            ? "Speak naturally about any textile or garment topic." 
            : "Engage in a real-time voice conversation with our expert AI."}
        </p>
      </div>

      <div className="flex items-center gap-6 -mt-2">
        <button 
          onClick={() => setIsMuted(!isMuted)}
          disabled={!isConnected}
          className={cn(
            "w-14 h-14 rounded-full flex items-center justify-center transition-all border border-white/10",
            isMuted ? "bg-red-500/20 text-red-500" : "bg-white/5 text-gray-400 hover:text-white disabled:opacity-30"
          )}
        >
          {isMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
        </button>
        
        <button 
          onClick={toggleConnection}
          disabled={isConnecting}
          className={cn(
            "px-8 py-4 rounded-2xl font-bold transition-all active:scale-95 shadow-lg flex items-center gap-2",
            isConnected 
              ? "bg-red-500 hover:bg-red-600 text-white shadow-red-500/20" 
              : "bg-teal-600 hover:bg-teal-500 text-white shadow-teal-600/20"
          )}
        >
          {isConnecting && <Loader2 size={18} className="animate-spin" />}
          {isConnected ? "End Session" : "Start Conversation"}
        </button>
      </div>
    </div>
  );
}
