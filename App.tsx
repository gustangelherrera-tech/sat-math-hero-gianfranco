
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { TranscriptionItem, SessionStatus, MathTopic } from './types';
import { decode, decodeAudioData, createBlob } from './utils/audio-helpers';
import Visualizer from './components/Visualizer';

const MATH_TOPICS: MathTopic[] = [
  { id: 'algebra', title: 'Álgebra', description: 'Ecuaciones lineales y sistemas.', icon: '📐' },
  { id: 'advanced-math', title: 'Mates Avanzadas', description: 'Cuadráticas, funciones y polinomios.', icon: '🚀' },
  { id: 'problem-solving', title: 'Resolución de Problemas', description: 'Razones, porcentajes y estadística.', icon: '📊' },
  { id: 'geometry', title: 'Geometría y Trig', description: 'Área, volumen y triángulos.', icon: '💎' },
];

const FORMULAS = [
  { name: 'Área Círculo', formula: 'A = πr²' },
  { name: 'Circunferencia', formula: 'C = 2πr' },
  { name: 'Teorema Pitágoras', formula: 'a² + b² = c²' },
  { name: 'Cuadrática', formula: 'x = [-b ± √(b² - 4ac)] / 2a' },
  { name: 'Volumen Cilindro', formula: 'V = πr²h' },
];

const App: React.FC = () => {
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  const [transcriptions, setTranscriptions] = useState<TranscriptionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [showFormulas, setShowFormulas] = useState(false);

  // Audio Contexts
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamRef = useRef<MediaStream | null>(null);
  
  // Gemini Session
  const sessionPromiseRef = useRef<Promise<any> | null>(null);

  const currentInputTextRef = useRef('');
  const currentOutputTextRef = useRef('');

  const stopSession = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    audioSourcesRef.current.forEach(source => source.stop());
    audioSourcesRef.current.clear();
    
    setStatus(SessionStatus.IDLE);
    sessionPromiseRef.current = null;
  }, []);

  const startSession = async (initialTopic?: string) => {
    try {
      if (status === SessionStatus.CONNECTED) {
        if (initialTopic) {
          sessionPromiseRef.current?.then((session) => {
            session.sendRealtimeInput({ text: `Gianfranco quiere practicar ${initialTopic}. Comienza con un problema básico.` });
          });
        }
        return;
      }

      setError(null);
      setStatus(SessionStatus.CONNECTING);

      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY || '' });

      // Initialize contexts
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: `Eres un tutor experto en Matemáticas para el Digital SAT (Versión 2025/2026) llamado "Tutor Hero". 
          Tu misión es ayudar a Gianfranco, un estudiante de 11vo grado que tiene dificultades con las matemáticas.
          
          DIRECTRICES:
          1. Habla siempre en español. Sé extremadamente paciente, alentador y motivador.
          2. El examen es el DIGITAL SAT. Las preguntas deben seguir el formato actual: cortas, concisas y con calculadora permitida (Desmos).
          3. Enfócate en las 4 áreas clave: 
             - Algebra (Linear equations, systems, inequalities)
             - Advanced Math (Quadratics, exponents, functions)
             - Problem Solving and Data Analysis (Ratios, percentages, statistics)
             - Geometry and Trigonometry (Area, volume, right triangles)
          4. No des la respuesta directamente. Usa el método socrático: haz preguntas que guíen a Gianfranco a descubrir el error o el siguiente paso.
          5. Si Gianfranco se siente frustrado, usa palabras de afirmación: "Vas por buen camino, Gianfranco", "Esta parte es difícil, pero la estás dominando".
          6. Usa ejemplos de la vida real o analogías si un concepto es muy abstracto.
          7. Menciona que puede usar el gráfico de Desmos si ayuda al problema.
          ${initialTopic ? `Empieza inmediatamente saludando a Gianfranco y proponiéndole un problema de ${initialTopic}.` : `Empieza saludando a Gianfranco y pregúntale con qué tema del SAT quiere empezar hoy.`}`,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setStatus(SessionStatus.CONNECTED);
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              if (isMuted) return;
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromiseRef.current?.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              currentOutputTextRef.current += message.serverContent.outputTranscription.text;
            } else if (message.serverContent?.inputTranscription) {
              currentInputTextRef.current += message.serverContent.inputTranscription.text;
            }

            if (message.serverContent?.turnComplete) {
              const userText = currentInputTextRef.current.trim();
              const modelText = currentOutputTextRef.current.trim();
              
              setTranscriptions(prev => [
                ...(userText ? [{ role: 'user' as const, text: userText, timestamp: Date.now() }] : []),
                ...(modelText ? [{ role: 'model' as const, text: modelText, timestamp: Date.now() }] : []),
                ...prev
              ].slice(0, 20));
              
              currentInputTextRef.current = '';
              currentOutputTextRef.current = '';
            }

            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              
              source.addEventListener('ended', () => {
                audioSourcesRef.current.delete(source);
              });
              
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              audioSourcesRef.current.add(source);
            }

            if (message.serverContent?.interrupted) {
              audioSourcesRef.current.forEach(s => s.stop());
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => {
            console.error('Session Error:', e);
            setError('Error de conexión. Por favor intenta de nuevo.');
            stopSession();
          },
          onclose: () => {
            stopSession();
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'No se pudo acceder al micrófono.');
      setStatus(SessionStatus.ERROR);
    }
  };

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 max-w-6xl mx-auto overflow-x-hidden">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-6 animate-fade-in">
        <div>
          <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-500 bg-clip-text text-transparent mb-2">
            SAT Math Hero
          </h1>
          <p className="text-slate-400 font-medium">Digital SAT Prep 2025/26 • <span className="text-blue-400">Para Gianfranco</span></p>
        </div>
        
        <div className="flex items-center gap-3">
          <a 
            href="https://www.desmos.com/testing/cb-digital-sat/graphing" 
            target="_blank" 
            rel="noopener noreferrer"
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-2 group"
          >
            <span className="w-2 h-2 rounded-full bg-green-500 group-hover:animate-ping" />
            ABRIR DESMOS
          </a>
          <div className="flex items-center gap-4 bg-slate-800/80 backdrop-blur p-2 px-4 rounded-2xl border border-slate-700 shadow-xl">
            <div className="flex flex-col items-center border-r border-slate-700 pr-4">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Nivel</span>
              <span className="text-lg font-bold text-blue-400">11º</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Racha</span>
              <span className="text-lg font-bold text-orange-400">🔥 5d</span>
            </div>
          </div>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-grow">
        {/* Left Column: Topics */}
        <div className="lg:col-span-3 space-y-6">
          <section className="bg-slate-800/40 p-6 rounded-3xl border border-slate-700 backdrop-blur-md shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
            </div>
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
              <span className="text-blue-400">🎯</span> Elige un Tema
            </h2>
            <div className="space-y-4">
              {MATH_TOPICS.map(topic => (
                <button 
                  key={topic.id}
                  onClick={() => startSession(topic.title)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all transform hover:-translate-y-1 active:scale-95 group ${
                    status === SessionStatus.CONNECTED ? 'border-slate-700 hover:border-blue-500/50 hover:bg-blue-500/10' : 'border-slate-700 hover:border-blue-500 bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <span className="text-3xl filter drop-shadow-md">{topic.icon}</span>
                    <div>
                      <h3 className="font-bold text-slate-200 group-hover:text-white transition-colors">{topic.title}</h3>
                      <p className="text-[10px] text-slate-500 font-medium group-hover:text-slate-400">{topic.description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Formula Quick Access */}
          <section className="bg-indigo-900/20 p-5 rounded-3xl border border-indigo-500/30">
            <button 
              onClick={() => setShowFormulas(!showFormulas)}
              className="w-full flex items-center justify-between text-indigo-300 font-bold text-sm"
            >
              <span>{showFormulas ? 'Ocultar Fórmulas' : 'Ver Fórmulas del SAT'}</span>
              <svg className={`w-4 h-4 transition-transform ${showFormulas ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {showFormulas && (
              <div className="mt-4 space-y-3 animate-slide-down">
                {FORMULAS.map((f, i) => (
                  <div key={i} className="p-3 bg-slate-900/50 rounded-xl border border-indigo-500/10">
                    <div className="text-[10px] text-indigo-400 font-bold uppercase mb-1">{f.name}</div>
                    <div className="math-font text-sm text-white">{f.formula}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Center: Live Tutor Interface */}
        <div className="lg:col-span-6 flex flex-col gap-6">
          <section className="bg-slate-800/40 rounded-3xl border border-slate-700 flex flex-col flex-grow shadow-2xl relative overflow-hidden min-h-[500px]">
            {/* Connection Indicator Bar */}
            <div className={`h-1.5 w-full transition-all duration-1000 ${
              status === SessionStatus.CONNECTED ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 
              status === SessionStatus.CONNECTING ? 'bg-yellow-500 animate-pulse' : 'bg-slate-700'
            }`} />

            <div className="p-6 border-b border-slate-700/50 flex justify-between items-center bg-slate-800/40 backdrop-blur">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${status === SessionStatus.CONNECTED ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`} />
                <h2 className="text-lg font-bold">Interacción de Voz</h2>
              </div>
              {status === SessionStatus.CONNECTED && (
                <Visualizer isActive={status === SessionStatus.CONNECTED} color="#60a5fa" />
              )}
            </div>

            <div className="flex-grow p-6 overflow-y-auto space-y-6 custom-scrollbar flex flex-col-reverse">
              <div className="space-y-6">
                {transcriptions.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 py-20 animate-fade-in">
                    <div className="w-20 h-20 bg-slate-700/30 rounded-full flex items-center justify-center mb-4">
                      <svg className="w-10 h-10 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    </div>
                    <p className="text-center max-w-xs font-medium">Presiona el botón para empezar tu clase personalizada con Tutor Hero.</p>
                  </div>
                ) : (
                  transcriptions.map((item, idx) => (
                    <div 
                      key={idx} 
                      className={`flex flex-col ${item.role === 'user' ? 'items-end' : 'items-start'} animate-slide-up`}
                    >
                      <span className={`text-[10px] mb-1 px-2 uppercase font-bold tracking-widest ${item.role === 'user' ? 'text-blue-400' : 'text-indigo-400'}`}>
                        {item.role === 'user' ? 'GIANFRANCO' : 'TUTOR HERO'}
                      </span>
                      <div className={`max-w-[90%] p-5 rounded-3xl shadow-lg border ${
                        item.role === 'user' 
                        ? 'bg-blue-600 text-white border-blue-400 rounded-tr-none' 
                        : 'bg-slate-700/80 text-slate-100 border-slate-600 rounded-tl-none'
                      }`}>
                        <p className={`${item.role === 'model' ? 'math-font' : ''} text-base leading-relaxed`}>
                          {item.text}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Mic Controls */}
            <div className="p-8 bg-slate-900/60 border-t border-slate-700/50 flex flex-col items-center gap-4">
              <div className="flex items-center gap-6">
                {status === SessionStatus.IDLE || status === SessionStatus.ERROR ? (
                  <button 
                    onClick={() => startSession()}
                    className="group relative flex items-center justify-center"
                  >
                    <div className="absolute inset-0 bg-blue-600 rounded-full blur-xl group-hover:blur-2xl transition-all opacity-40" />
                    <div className="relative px-12 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-black text-lg transition-all shadow-2xl flex items-center gap-3">
                      <span>EMPEZAR TUTORÍA</span>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </div>
                  </button>
                ) : (
                  <div className="flex items-center gap-6">
                    <button 
                      onClick={() => setIsMuted(!isMuted)}
                      className={`w-16 h-16 rounded-full flex items-center justify-center transition-all border-4 shadow-xl active:scale-90 ${
                        isMuted ? 'bg-red-600 border-red-400 hover:bg-red-500' : 'bg-slate-700 border-slate-600 hover:bg-slate-600'
                      }`}
                    >
                      {isMuted ? (
                        <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                      ) : (
                        <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                      )}
                    </button>
                    <button 
                      onClick={stopSession}
                      className="px-8 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-full font-bold transition-all border border-slate-600"
                    >
                      Terminar
                    </button>
                  </div>
                )}
              </div>
              {status === SessionStatus.CONNECTED && (
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest animate-pulse">
                  Conexión segura establecida con Gemini AI
                </p>
              )}
            </div>
          </section>
        </div>

        {/* Right Column: Tips & Resources */}
        <div className="lg:col-span-3 space-y-6">
          <section className="bg-slate-800/40 p-6 rounded-3xl border border-slate-700">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span className="text-yellow-400">💡</span> Tips para Gianfranco
            </h2>
            <div className="space-y-4">
              <div className="p-4 bg-slate-700/30 rounded-2xl border-l-4 border-yellow-500">
                <p className="text-xs text-slate-300 leading-relaxed italic">
                  "Si no sabes por dónde empezar, intenta dibujar el problema o graficarlo en Desmos."
                </p>
              </div>
              <div className="p-4 bg-slate-700/30 rounded-2xl border-l-4 border-blue-500">
                <p className="text-xs text-slate-300 leading-relaxed italic">
                  "No te preocupes por el tiempo al principio, enfócate en entender el concepto."
                </p>
              </div>
              <div className="p-4 bg-slate-700/30 rounded-2xl border-l-4 border-green-500">
                <p className="text-xs text-slate-300 leading-relaxed italic">
                  "En el Digital SAT, todas las preguntas valen lo mismo. ¡Asegura las fáciles!"
                </p>
              </div>
            </div>
          </section>

          <section className="bg-gradient-to-br from-indigo-900/40 to-purple-900/40 p-6 rounded-3xl border border-indigo-500/30 shadow-2xl">
            <h2 className="text-xl font-bold mb-4">Recursos</h2>
            <ul className="space-y-3">
              <li>
                <a href="#" className="flex items-center gap-2 text-sm text-indigo-300 hover:text-white transition-colors">
                  <span className="text-xs">📘</span> Guía Digital SAT 2025
                </a>
              </li>
              <li>
                <a href="https://www.khanacademy.org/test-prep/digital-sat" target="_blank" className="flex items-center gap-2 text-sm text-indigo-300 hover:text-white transition-colors">
                  <span className="text-xs">🏫</span> Khan Academy SAT
                </a>
              </li>
              <li>
                <a href="https://bluebook.collegeboard.org/" target="_blank" className="flex items-center gap-2 text-sm text-indigo-300 hover:text-white transition-colors">
                  <span className="text-xs">💻</span> App Bluebook
                </a>
              </li>
            </ul>
          </section>
        </div>
      </main>

      {error && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 p-4 bg-red-600 text-white rounded-2xl shadow-2xl flex items-center gap-3 animate-bounce z-50">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <span className="font-bold text-sm">{error}</span>
          <button onClick={() => setError(null)} className="p-1 hover:bg-red-500 rounded">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      <footer className="mt-12 text-center">
        <div className="inline-block p-1 px-4 bg-slate-800/50 rounded-full border border-slate-700/50">
           <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
            Diseñado con IA para Gianfranco • SAT Master Pro 2025
           </p>
        </div>
      </footer>
      
      <style>{`
        @keyframes fade-in { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slide-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slide-down { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-fade-in { animation: fade-in 0.8s ease-out forwards; }
        .animate-slide-up { animation: slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-slide-down { animation: slide-down 0.3s ease-out forwards; }
        
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(148, 163, 184, 0.3); }
      `}</style>
    </div>
  );
};

export default App;
