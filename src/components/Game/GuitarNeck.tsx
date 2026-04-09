import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Zap, Flame, Music, ArrowLeft, RotateCcw } from 'lucide-react';
import confetti from 'canvas-confetti';
import { SongData, NotePattern } from '../../lib/gemini';
import { Socket } from 'socket.io-client';
import { db, doc, updateDoc } from '../../lib/firebase';

import { cn } from '../../lib/utils';

interface GuitarNeckProps {
  songData: SongData;
  onFinish: () => void;
  socket: Socket | null;
  roomId?: string;
  opponentScore?: any;
}

const COLORS = [
  '#22c55e', // Green
  '#ef4444', // Red
  '#eab308', // Yellow
  '#3b82f6', // Blue
  '#f97316', // Orange
];

const NOTE_SPEED = 400; // pixels per second
const HIT_WINDOW = 0.2; // seconds (slightly more lenient for typing)
const NECK_HEIGHT = 600;

// Map characters to 5 lanes based on keyboard regions
const getLaneIndex = (key: string): number => {
  const k = key.toLowerCase();
  if ('12qwaszx'.includes(k)) return 0;
  if ('34erdfcv'.includes(k)) return 1;
  if ('56tyghbn'.includes(k)) return 2;
  if ('78uijkml'.includes(k)) return 3;
  return 4; // Default for right-side keys and others
};

export default function GuitarNeck({ songData, onFinish, socket, roomId, opponentScore }: GuitarNeckProps) {
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [maxCombo, setMaxCombo] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [isFocused, setIsFocused] = useState(true);
  const [totalHits, setTotalHits] = useState(0);
  const [totalMisses, setTotalMisses] = useState(0);
  const [wpm, setWpm] = useState(0);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const requestRef = useRef<number>(null);
  const notesRef = useRef<NotePattern[]>([]);
  const hitNotesRef = useRef<Set<number>>(new Set());

  // Focus management
  useEffect(() => {
    const handleBlur = () => setIsFocused(false);
    const handleFocus = () => setIsFocused(true);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Initialize notes
  useEffect(() => {
    notesRef.current = [...songData.patterns].sort((a, b) => a.time - b.time);
  }, [songData]);

  // WPM Calculation
  useEffect(() => {
    if (isFinished || !audioRef.current || audioRef.current.currentTime === 0) return;
    const interval = setInterval(() => {
      if (audioRef.current) {
        const minutes = audioRef.current.currentTime / 60;
        const currentWpm = Math.round((totalHits / 5) / minutes) || 0;
        setWpm(currentWpm);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [totalHits, isFinished]);

  const handleHit = useCallback((key: string) => {
    if (!audioRef.current) return;
    const currentTime = audioRef.current.currentTime;
    const pressedKey = key.toLowerCase();
    
    // Find closest note for this key that hasn't been hit
    let hitFound = false;
    for (let i = 0; i < notesRef.current.length; i++) {
      const note = notesRef.current[i];
      if (note.key.toLowerCase() === pressedKey && !hitNotesRef.current.has(i)) {
        const diff = Math.abs(note.time - currentTime);
        if (diff < HIT_WINDOW) {
          hitNotesRef.current.add(i);
          setScore(s => s + (100 * multiplier));
          setTotalHits(h => h + 1);
          setCombo(c => {
            const newCombo = c + 1;
            if (newCombo > maxCombo) setMaxCombo(newCombo);
            return newCombo;
          });
          setMultiplier(c => Math.min(4, Math.floor((combo + 1) / 10) + 1));
          hitFound = true;
          break;
        }
      }
    }

    if (!hitFound) {
      setCombo(0);
      setMultiplier(1);
      setTotalMisses(m => m + 1);
    }
  }, [combo, multiplier, maxCombo]);

  // Keyboard listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier keys
      if (e.key.length > 1 && e.key !== 'Enter' && e.key !== 'Backspace' && e.key !== ' ') return;
      
      const key = e.key.toLowerCase();
      setActiveKeys(prev => new Set(prev).add(key));
      handleHit(key);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      setActiveKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleHit]);

  // Sync score to socket
  useEffect(() => {
    if (socket && roomId) {
      socket.emit('update-score', roomId, { score, combo, multiplier, wpm });
    }
  }, [score, combo, multiplier, wpm, socket, roomId]);

  const finishGame = useCallback(async () => {
    if (isFinished) return;
    setIsFinished(true);
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: COLORS
    });

    // Update high score in Firestore if it's a new record
    if (songData.id && score > (songData.highScore || 0)) {
      try {
        await updateDoc(doc(db, 'songs', songData.id), {
          highScore: score
        });
      } catch (error) {
        console.error("Error updating high score:", error);
      }
    }
  }, [score, songData, isFinished]);

  // Game Loop
  const animate = useCallback((time: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const audio = audioRef.current;
    if (!canvas || !ctx || !audio) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const currentTime = audio.currentTime;

    // Draw strings/lanes
    const laneWidth = canvas.width / 5;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(i * laneWidth, 0);
      ctx.lineTo(i * laneWidth, canvas.height);
      ctx.stroke();
    }

    // Draw hit zone
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, canvas.height - 100, canvas.width, 80);

    // Draw notes
    notesRef.current.forEach((note, index) => {
      if (hitNotesRef.current.has(index)) return;

      const timeUntilHit = note.time - currentTime;
      const y = canvas.height - 100 - (timeUntilHit * NOTE_SPEED);

      // If note passed the hit zone
      if (y > canvas.height) {
        if (!hitNotesRef.current.has(index)) {
          hitNotesRef.current.add(index);
          setCombo(0);
          setMultiplier(1);
          setTotalMisses(m => m + 1);
        }
        return;
      }

      // Only draw if on screen
      if (y > -50 && y < canvas.height) {
        const laneIndex = getLaneIndex(note.key);
        const x = laneIndex * laneWidth + laneWidth / 2;
        
        ctx.shadowBlur = 15;
        ctx.shadowColor = COLORS[laneIndex];
        ctx.fillStyle = COLORS[laneIndex];
        ctx.beginPath();
        ctx.arc(x, y, 30, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Inner circle with character
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'black';
        ctx.font = 'bold 16px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(note.key.toUpperCase(), x, y);
      }
    });

    if (audio.ended && !isFinished) {
      finishGame();
    }

    requestRef.current = requestAnimationFrame(animate);
  }, [isFinished, finishGame]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [animate]);

  const accuracy = totalHits + totalMisses > 0 
    ? Math.round((totalHits / (totalHits + totalMisses)) * 100) 
    : 100;

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden bg-black">
      {/* Focus Overlay */}
      {!isFocused && !isFinished && (
        <div 
          className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm cursor-pointer"
          onClick={() => window.focus()}
        >
          <div className="text-center animate-pulse">
            <Zap className="w-16 h-16 text-orange-500 mx-auto mb-4" />
            <h2 className="text-2xl font-black uppercase italic tracking-widest">Click to Focus</h2>
            <p className="text-zinc-400 text-sm mt-2 uppercase font-bold">Keyboard controls require window focus</p>
          </div>
        </div>
      )}

      {/* HUD - Top */}
      <div className="absolute top-0 left-0 right-0 p-8 flex justify-between items-start z-20">
        <div className="flex flex-col gap-2">
          <button 
            onClick={onFinish}
            className="flex items-center gap-2 text-zinc-500 hover:text-white transition-colors uppercase text-xs font-bold tracking-widest mb-4"
          >
            <ArrowLeft className="w-4 h-4" /> Quit Session
          </button>
          <div className="flex items-center gap-4">
            <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-2xl backdrop-blur-md">
              <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Score</span>
              <span className="text-4xl font-black italic tabular-nums text-orange-500">{score.toLocaleString()}</span>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-2xl backdrop-blur-md">
              <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">WPM</span>
              <span className="text-4xl font-black italic text-yellow-400">{wpm}</span>
            </div>
            <div className="bg-zinc-900/80 border border-zinc-800 p-4 rounded-2xl backdrop-blur-md">
              <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Accuracy</span>
              <span className="text-4xl font-black italic text-blue-400">{accuracy}%</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-4">
          <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/20 px-6 py-3 rounded-full">
            <Flame className={cn("w-6 h-6 text-orange-500", combo > 10 && "animate-bounce")} />
            <span className="text-2xl font-black italic uppercase tracking-tight">{combo} COMBO</span>
          </div>
          
          {opponentScore && (
            <div className="bg-purple-500/10 border border-purple-500/20 p-4 rounded-2xl backdrop-blur-md text-right">
              <span className="block text-[10px] font-bold text-purple-500 uppercase tracking-widest mb-1">Opponent</span>
              <span className="text-2xl font-black italic tabular-nums text-purple-400">{opponentScore.score.toLocaleString()}</span>
              <div className="text-[10px] font-bold text-purple-500/50 uppercase mt-1">{opponentScore.wpm} WPM • {opponentScore.combo} Combo</div>
            </div>
          )}
        </div>
      </div>

      {/* Lyrics Display - Moved to side */}
      <div className="absolute left-8 top-1/2 -translate-y-1/2 w-64 max-h-[60%] overflow-y-auto z-10 hidden lg:block">
        <div className="bg-zinc-900/40 border border-zinc-800/50 p-6 rounded-3xl backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-4 text-orange-500">
            <Music className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Lyrics</span>
          </div>
          <p className="text-sm text-zinc-400 leading-relaxed italic font-medium">
            {songData.lyrics}
          </p>
        </div>
      </div>

      {/* Game Area */}
      <div className="relative w-[500px] h-full bg-zinc-900/20 border-x border-zinc-800/50">
        {/* Fretboard perspective effect */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-zinc-900/10 to-zinc-900/40" />
        
        <canvas 
          ref={canvasRef}
          width={500}
          height={NECK_HEIGHT}
          className="absolute bottom-0 left-0 w-full h-full"
        />

        {/* Hit Zone UI - Simplified for typing */}
        <div className="absolute bottom-[20px] left-0 right-0 h-[80px] flex justify-around items-center px-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div 
              key={i}
              className={cn(
                "w-16 h-16 rounded-full border-4 flex flex-col items-center justify-center transition-all duration-75",
                Array.from(activeKeys).some(k => getLaneIndex(k) === i)
                  ? "scale-110 border-white shadow-[0_0_20px_white]" 
                  : "border-zinc-700 opacity-20"
              )}
              style={{ 
                backgroundColor: Array.from(activeKeys).some(k => getLaneIndex(k) === i) ? COLORS[i] : 'transparent',
                borderColor: Array.from(activeKeys).some(k => getLaneIndex(k) === i) ? 'white' : COLORS[i]
              }}
            />
          ))}
        </div>
      </div>

      {/* Song Info - Bottom Right */}
      <div className="absolute bottom-8 right-8 text-right z-10">
        <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-1">Now Playing</span>
        <h3 className="text-2xl font-black uppercase italic tracking-tighter text-white">{songData.title}</h3>
        <p className="text-xs text-orange-500 font-bold uppercase tracking-widest mt-1">{songData.genre}</p>
      </div>

      {/* Results Overlay */}
      <AnimatePresence>
        {isFinished && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-xl p-6"
          >
            <div className="max-w-2xl w-full text-center">
              <motion.div
                initial={{ scale: 0.8, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="mb-12"
              >
                <Trophy className="w-24 h-24 text-yellow-400 mx-auto mb-6 filter drop-shadow-[0_0_20px_rgba(250,204,21,0.4)]" />
                <h2 className="text-6xl font-black uppercase italic tracking-tighter mb-2">Session Complete</h2>
                <p className="text-zinc-400 font-bold uppercase tracking-widest">You shredded the keyboard!</p>
              </motion.div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-[32px]">
                  <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Final Score</span>
                  <span className="text-3xl font-black italic text-orange-500">{score.toLocaleString()}</span>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-[32px]">
                  <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Avg WPM</span>
                  <span className="text-3xl font-black italic text-yellow-400">{wpm}</span>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-[32px]">
                  <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Accuracy</span>
                  <span className="text-3xl font-black italic text-blue-400">{accuracy}%</span>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-[32px]">
                  <span className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Max Combo</span>
                  <span className="text-3xl font-black italic text-purple-400">{maxCombo}</span>
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-4">
                <button 
                  onClick={onFinish}
                  className="flex-1 py-5 bg-white text-black font-black uppercase italic rounded-2xl hover:bg-zinc-200 transition-all flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-5 h-5" /> Back to Home
                </button>
                <button 
                  onClick={() => window.location.reload()}
                  className="flex-1 py-5 bg-orange-500 text-black font-black uppercase italic rounded-2xl hover:bg-orange-400 transition-all flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-5 h-5" /> Shred Again
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <audio 
        ref={audioRef}
        src={songData.audioUrl}
        onEnded={finishGame}
        autoPlay
      />
    </div>
  );
}
