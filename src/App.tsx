import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Music, 
  Users, 
  Play, 
  Trophy, 
  MessageSquare, 
  Zap, 
  Settings, 
  Share2, 
  ArrowLeft,
  Loader2,
  Guitar,
  Mic2,
  Keyboard,
  Library as LibraryIcon,
  LogIn,
  LogOut
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { generateSong, getGeminiChat, SongData } from './lib/gemini';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  onAuthStateChanged, 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  User
} from './lib/firebase';
import GuitarNeck from './components/Game/GuitarNeck';
import GeminiAssistant from './components/Chat/GeminiAssistant';
import { cn } from './lib/utils';

type GameMode = 'home' | 'single' | 'multiplayer' | 'playing' | 'lobby' | 'library';

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function App() {
  const [mode, setMode] = useState<GameMode>('home');
  const [roomId, setRoomId] = useState<string>('');
  const [username, setUsername] = useState<string>(`Rocker_${Math.floor(Math.random() * 1000)}`);
  const [roomData, setRoomData] = useState<any>(null);
  const [songData, setSongData] = useState<SongData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [prompt, setPrompt] = useState('Heavy Metal Shredding');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [opponentScore, setOpponentScore] = useState<any>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [library, setLibrary] = useState<SongData[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setUsername(currentUser.displayName || `Rocker_${currentUser.uid.substring(0, 4)}`);
      }
    });
    return () => unsubscribe();
  }, []);

  // Library Listener
  useEffect(() => {
    if (!user) {
      setLibrary([]);
      return;
    }

    setIsLoadingLibrary(true);
    const q = query(
      collection(db, 'songs'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const songs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SongData[];
      setLibrary(songs);
      setIsLoadingLibrary(false);
    }, (error) => {
      console.error("Library fetch error:", error);
      setIsLoadingLibrary(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = () => auth.signOut();

  // Check for API key on mount
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      }
    };
    checkKey();
  }, []);

  const handleOpenKeySelector = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  // Initialize socket
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('room-update', (data) => {
      setRoomData(data);
    });

    newSocket.on('start-generation', () => {
      setIsGenerating(true);
    });

    newSocket.on('game-start', (data) => {
      setSongData(data);
      setMode('playing');
      setIsGenerating(false);
    });

    newSocket.on('opponent-score', (data) => {
      setOpponentScore(data);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Handle room joining from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rId = params.get('room');
    if (rId && socket) {
      setRoomId(rId);
      setMode('lobby');
      socket.emit('join-room', rId, username);
    }
  }, [socket]);

  const createRoom = () => {
    const rId = Math.random().toString(36).substring(7);
    setRoomId(rId);
    setMode('lobby');
    socket?.emit('join-room', rId, username);
    window.history.pushState({}, '', `?room=${rId}`);
  };

  const startSinglePlayer = async () => {
    if (!hasApiKey) {
      await handleOpenKeySelector();
    }
    
    setIsGenerating(true);
    try {
      const data = await generateSong(prompt, user?.uid);
      setSongData(data);
      setMode('playing');
    } catch (error: any) {
      console.error("Failed to generate song:", error);
      if (error.message?.includes('permission') || error.message?.includes('403')) {
        setHasApiKey(false);
        alert("API Key permission denied. Please select a valid paid API key.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReady = () => {
    socket?.emit('player-ready', roomId);
  };

  // If we are in multiplayer and generating, only one person (host or first) should trigger generation
  useEffect(() => {
    if (mode === 'lobby' && isGenerating && socket && roomData) {
      // Simple logic: first player in list generates
      if (roomData.players[0].id === socket.id && !songData) {
        generateSong(prompt, user?.uid).then(data => {
          socket.emit('song-generated', roomId, data);
        }).catch(error => {
          console.error("Multiplayer generation error:", error);
          if (error.message?.includes('permission') || error.message?.includes('403')) {
            setHasApiKey(false);
            setIsGenerating(false);
          }
        });
      }
    }
  }, [isGenerating, mode, socket, roomData, songData, user]);

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-orange-500 selection:text-black">
      {/* Background Atmosphere */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-500/10 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 blur-[120px] rounded-full animate-pulse delay-1000" />
      </div>

      {/* Top Bar / Auth */}
      <div className="fixed top-0 left-0 right-0 z-[100] p-6 flex justify-between items-center pointer-events-none">
        <div className="pointer-events-auto">
          <h1 
            onClick={() => setMode('home')}
            className="text-2xl font-black uppercase italic tracking-tighter cursor-pointer hover:text-orange-500 transition-colors"
          >
            AI <span className="text-orange-500">SHREDDER</span>
          </h1>
        </div>
        <div className="flex items-center gap-4 pointer-events-auto">
          {user ? (
            <div className="flex items-center gap-4 bg-zinc-900/80 border border-zinc-800 p-2 pl-4 rounded-full backdrop-blur-md">
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">{user.displayName}</span>
              <button 
                onClick={handleLogout}
                className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-500 hover:text-red-500"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button 
              onClick={handleLogin}
              className="flex items-center gap-2 px-6 py-2 bg-white text-black font-bold uppercase italic text-sm rounded-full hover:bg-zinc-200 transition-all"
            >
              <LogIn className="w-4 h-4" /> Login
            </button>
          )}
        </div>
      </div>

      {!hasApiKey && mode !== 'playing' && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-6">
          <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 p-8 rounded-[32px] text-center">
            <Settings className="w-16 h-16 text-orange-500 mx-auto mb-6" />
            <h2 className="text-3xl font-black uppercase italic tracking-tighter mb-4">API Key Required</h2>
            <p className="text-zinc-400 mb-8">
              To generate AI music with Lyria, you need to select a valid API key from a paid Google Cloud project.
            </p>
            <button 
              onClick={handleOpenKeySelector}
              className="w-full py-4 bg-orange-500 text-black font-black uppercase italic rounded-2xl hover:bg-orange-400 transition-all flex items-center justify-center gap-2"
            >
              <Zap className="w-5 h-5" /> Select API Key
            </button>
            <p className="mt-4 text-[10px] text-zinc-500 uppercase tracking-widest">
              See <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="underline">billing docs</a> for details.
            </p>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {mode === 'home' && (
          <motion.div 
            key="home"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="relative z-10 flex flex-col items-center justify-center min-h-screen p-6 text-center"
          >
            <motion.div
              initial={{ scale: 0.8, rotate: -5 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 200 }}
              className="mb-8"
            >
              <div className="relative">
                <Keyboard className="w-32 h-32 text-orange-500 filter drop-shadow-[0_0_15px_rgba(249,115,22,0.5)]" />
                <Zap className="absolute -top-2 -right-2 w-12 h-12 text-yellow-400 animate-bounce" />
              </div>
            </motion.div>

            <h1 className="text-7xl md:text-9xl font-black tracking-tighter uppercase mb-4 italic skew-x-[-5deg]">
              TYPING <span className="text-orange-500">HERO</span>
            </h1>
            <p className="text-xl text-zinc-400 max-w-2xl mb-12 font-medium">
              The world's first AI-powered touch typing shredder. Generate custom tracks with Gemini and master the keyboard.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
              <button 
                onClick={() => setMode('single')}
                className="group relative flex flex-col items-center p-8 bg-zinc-900/50 border border-zinc-800 rounded-3xl hover:border-orange-500/50 transition-all hover:bg-zinc-900/80"
              >
                <Play className="w-12 h-12 mb-4 text-orange-500 group-hover:scale-110 transition-transform" />
                <span className="text-2xl font-bold uppercase italic tracking-tight">Solo Jam</span>
                <span className="text-sm text-zinc-500 mt-2">Generate custom AI tracks</span>
              </button>

              <button 
                onClick={createRoom}
                className="group relative flex flex-col items-center p-8 bg-zinc-900/50 border border-zinc-800 rounded-3xl hover:border-purple-500/50 transition-all hover:bg-zinc-900/80"
              >
                <Users className="w-12 h-12 mb-4 text-purple-500 group-hover:scale-110 transition-transform" />
                <span className="text-2xl font-bold uppercase italic tracking-tight">Battle Mode</span>
                <span className="text-sm text-zinc-500 mt-2">Challenge friends in real-time</span>
              </button>

              <button 
                onClick={() => setMode('library')}
                className="group relative flex flex-col items-center p-8 bg-zinc-900/50 border border-zinc-800 rounded-3xl hover:border-yellow-500/50 transition-all hover:bg-zinc-900/80"
              >
                <LibraryIcon className="w-12 h-12 mb-4 text-yellow-500 group-hover:scale-110 transition-transform" />
                <span className="text-2xl font-bold uppercase italic tracking-tight">Library</span>
                <span className="text-sm text-zinc-500 mt-2">Play your saved tracks</span>
              </button>
            </div>

            <div className="mt-16 flex items-center gap-8 text-zinc-500 uppercase text-xs font-bold tracking-widest">
              <div className="flex items-center gap-2"><Music className="w-4 h-4" /> Lyria Powered</div>
              <div className="flex items-center gap-2"><Zap className="w-4 h-4" /> Real-time Sockets</div>
              <div className="flex items-center gap-2"><Keyboard className="w-4 h-4" /> Keyboard Controls</div>
            </div>
          </motion.div>
        )}

        {mode === 'library' && (
          <motion.div 
            key="library"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10 flex flex-col items-center justify-center min-h-screen p-6 pt-24"
          >
            <button 
              onClick={() => setMode('home')}
              className="absolute top-8 left-8 p-3 bg-zinc-900 border border-zinc-800 rounded-full hover:bg-zinc-800 transition-colors pointer-events-auto"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>

            <div className="w-full max-w-4xl">
              <div className="flex justify-between items-end mb-8">
                <div>
                  <h2 className="text-5xl font-black uppercase italic tracking-tighter">Your Typing Tracks</h2>
                  <p className="text-zinc-500 font-bold uppercase tracking-widest mt-1">
                    {library.length} Tracks Saved
                  </p>
                </div>
              </div>

              {!user ? (
                <div className="bg-zinc-900/50 border border-zinc-800 p-12 rounded-[40px] text-center">
                  <LogIn className="w-16 h-16 text-zinc-700 mx-auto mb-6" />
                  <h3 className="text-2xl font-bold uppercase italic mb-2">Login Required</h3>
                  <p className="text-zinc-500 mb-8">You need to be logged in to save and view your library.</p>
                  <button 
                    onClick={handleLogin}
                    className="px-8 py-3 bg-white text-black font-bold uppercase italic rounded-full hover:bg-zinc-200 transition-all"
                  >
                    Login with Google
                  </button>
                </div>
              ) : isLoadingLibrary ? (
                <div className="flex flex-col items-center justify-center p-24">
                  <Loader2 className="w-12 h-12 text-orange-500 animate-spin mb-4" />
                  <p className="text-zinc-500 font-bold uppercase tracking-widest">Fetching your tracks...</p>
                </div>
              ) : library.length === 0 ? (
                <div className="bg-zinc-900/50 border border-zinc-800 p-12 rounded-[40px] text-center">
                  <Music className="w-16 h-16 text-zinc-700 mx-auto mb-6" />
                  <h3 className="text-2xl font-bold uppercase italic mb-2">No Tracks Yet</h3>
                  <p className="text-zinc-500 mb-8">Generate your first typing track to see it here!</p>
                  <button 
                    onClick={() => setMode('single')}
                    className="px-8 py-3 bg-orange-500 text-black font-bold uppercase italic rounded-full hover:bg-orange-400 transition-all"
                  >
                    Generate Typing Track
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {library.map((song) => (
                    <motion.div 
                      key={song.id}
                      whileHover={{ scale: 1.02 }}
                      className="group bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl hover:border-orange-500/50 transition-all cursor-pointer"
                      onClick={() => {
                        setSongData(song);
                        setMode('playing');
                      }}
                    >
                      <div className="flex justify-between items-start mb-4">
                        <div className="p-3 bg-orange-500/10 rounded-2xl group-hover:bg-orange-500/20 transition-colors">
                          <Music className="w-6 h-6 text-orange-500" />
                        </div>
                        <div className="text-right">
                          <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest">High Score</span>
                          <span className="text-xl font-black italic text-yellow-400">{(song.highScore || 0).toLocaleString()}</span>
                        </div>
                      </div>
                      <h3 className="text-xl font-bold uppercase italic tracking-tight mb-1 truncate">{song.title}</h3>
                      <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest truncate">{song.genre}</p>
                      <div className="mt-6 flex items-center justify-between">
                        <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">
                          {new Date(song.createdAt!).toLocaleDateString()}
                        </span>
                        <div className="flex items-center gap-2 text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-xs font-black uppercase italic">Play Now</span>
                          <Play className="w-4 h-4 fill-current" />
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {mode === 'single' && (
          <motion.div 
            key="single"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10 flex flex-col items-center justify-center min-h-screen p-6"
          >
            <button 
              onClick={() => setMode('home')}
              className="absolute top-8 left-8 p-3 bg-zinc-900 border border-zinc-800 rounded-full hover:bg-zinc-800 transition-colors"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>

            <div className="w-full max-w-xl bg-zinc-900/80 border border-zinc-800 p-10 rounded-[40px] backdrop-blur-xl">
              <h2 className="text-4xl font-black uppercase italic mb-8 tracking-tighter">Configure Your Track</h2>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold uppercase text-zinc-500 tracking-widest mb-2">Track Vibe / Prompt</label>
                  <input 
                    type="text" 
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g. 80s Synthwave, Death Metal, Funky Jazz..."
                    className="w-full bg-black border border-zinc-800 p-4 rounded-2xl focus:outline-none focus:border-orange-500 transition-colors text-lg"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-black/50 border border-zinc-800 rounded-2xl">
                    <span className="block text-[10px] font-bold text-zinc-500 uppercase mb-1">Difficulty</span>
                    <span className="text-orange-500 font-bold uppercase italic">Medium</span>
                  </div>
                  <div className="p-4 bg-black/50 border border-zinc-800 rounded-2xl">
                    <span className="block text-[10px] font-bold text-zinc-500 uppercase mb-1">Duration</span>
                    <span className="text-zinc-300 font-bold uppercase italic">30 Seconds</span>
                  </div>
                </div>

                <button 
                  onClick={startSinglePlayer}
                  disabled={isGenerating}
                  className="w-full py-6 bg-orange-500 text-black font-black uppercase italic text-2xl rounded-2xl hover:bg-orange-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-8 h-8 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Zap className="w-8 h-8" />
                      Start Typing
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {mode === 'lobby' && (
          <motion.div 
            key="lobby"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="relative z-10 flex flex-col items-center justify-center min-h-screen p-6"
          >
            <div className="w-full max-w-2xl bg-zinc-900/80 border border-zinc-800 p-10 rounded-[40px] backdrop-blur-xl">
              <div className="flex justify-between items-start mb-12">
                <div>
                  <h2 className="text-4xl font-black uppercase italic tracking-tighter">Battle Lobby</h2>
                  <p className="text-zinc-500 text-sm font-bold uppercase tracking-widest mt-1">Room ID: {roomId}</p>
                </div>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    alert("Link copied!");
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-800 rounded-full text-xs font-bold uppercase hover:bg-zinc-700 transition-colors"
                >
                  <Share2 className="w-4 h-4" /> Share Link
                </button>
              </div>

              <div className="space-y-4 mb-12">
                {roomData?.players.map((player: any) => (
                  <div key={player.id} className="flex items-center justify-between p-4 bg-black/50 border border-zinc-800 rounded-2xl">
                    <div className="flex items-center gap-4">
                      <div className={cn("w-3 h-3 rounded-full", player.ready ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" : "bg-zinc-700")} />
                      <span className="text-xl font-bold italic uppercase">{player.username} {player.id === socket?.id && "(You)"}</span>
                    </div>
                    <span className={cn("text-xs font-bold uppercase", player.ready ? "text-green-500" : "text-zinc-500")}>
                      {player.ready ? "Ready" : "Waiting..."}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mb-8">
                <label className="block text-xs font-bold uppercase text-zinc-500 tracking-widest mb-2">Battle Theme</label>
                <input 
                  type="text" 
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full bg-black border border-zinc-800 p-4 rounded-2xl focus:outline-none focus:border-purple-500 transition-colors text-lg"
                />
              </div>

              <button 
                onClick={handleReady}
                disabled={isGenerating}
                className="w-full py-6 bg-purple-600 text-white font-black uppercase italic text-2xl rounded-2xl hover:bg-purple-500 transition-all disabled:opacity-50 flex items-center justify-center gap-3"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-8 h-8 animate-spin" />
                    AI Generating Track...
                  </>
                ) : (
                  <>
                    <Trophy className="w-8 h-8" />
                    I'm Ready
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {mode === 'playing' && songData && (
          <motion.div 
            key="playing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 bg-black"
          >
            <GuitarNeck 
              songData={songData} 
              onFinish={() => {
                setMode('home');
                setSongData(null);
                window.history.pushState({}, '', '/');
              }}
              socket={socket}
              roomId={roomId}
              opponentScore={opponentScore}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Gemini Assistant */}
      <GeminiAssistant />
    </div>
  );
}
