import { GoogleGenAI, Modality, Type } from "@google/genai";
import { db, collection, addDoc, auth } from './firebase';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface NotePattern {
  time: number; // in seconds
  key: string; // "A", "S", "D", "F", "G" or numbers "1", "2", "3", "4", "5"
  duration?: number; // for long notes
}

export interface SongData {
  id?: string;
  audioUrl: string;
  lyrics: string;
  patterns: NotePattern[];
  bpm: number;
  genre: string;
  title: string;
  userId?: string;
  createdAt?: string;
  highScore?: number;
}

export async function generateSong(prompt: string, userId?: string): Promise<SongData> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  
  // 1. Generate Music with Lyria
  const musicResponse = await ai.models.generateContentStream({
    model: "lyria-3-clip-preview",
    contents: `Generate a 30-second high-energy track for a guitar hero game. Style: ${prompt}. Make it rhythmic and fun to play.`,
  });

  let audioBase64 = "";
  let lyrics = "";
  let mimeType = "audio/wav";

  for await (const chunk of musicResponse) {
    const parts = chunk.candidates?.[0]?.content?.parts;
    if (!parts) continue;
    for (const part of parts) {
      if (part.inlineData?.data) {
        if (!audioBase64 && part.inlineData.mimeType) {
          mimeType = part.inlineData.mimeType;
        }
        audioBase64 += part.inlineData.data;
      }
      if (part.text && !lyrics) {
        lyrics = part.text;
      }
    }
  }

  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const audioUrl = URL.createObjectURL(blob);

  // 2. Generate Note Patterns with Gemini Flash
  const patternResponse = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Based on this song description: "${prompt}" and lyrics: "${lyrics}", generate a JSON array of note patterns for a touch-typing game.
    The song is 30 seconds long.
    Notes should be timed between 0 and 30 seconds.
    The "key" for each note MUST be a single character (letter, number, or punctuation) that appears in the lyrics or fits the theme.
    Spread the notes across the full keyboard to help with touch typing practice.
    Return ONLY the JSON array.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            time: { type: Type.NUMBER, description: "Time in seconds (0-30)" },
            key: { type: Type.STRING, description: "The single character key to press" },
            duration: { type: Type.NUMBER, description: "Optional duration for long notes" }
          },
          required: ["time", "key"]
        }
      }
    }
  });

  const patterns = JSON.parse(patternResponse.text || "[]");
  const songData: SongData = {
    audioUrl,
    lyrics,
    patterns,
    bpm: 120,
    genre: prompt,
    title: `AI Shred Session - ${prompt.substring(0, 15)}...`,
    userId,
    createdAt: new Date().toISOString()
  };

  // 3. Save to Firestore if userId is provided
  if (userId) {
    try {
      const docRef = await addDoc(collection(db, 'songs'), songData);
      songData.id = docRef.id;
    } catch (error) {
      console.error("Error saving song to Firestore:", error);
    }
  }

  return songData;
}

export async function getGeminiChat() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  return ai.chats.create({
    model: "gemini-3-flash-preview",
    config: {
      systemInstruction: `You are a legendary rock star and guitar coach. 
      Help the user create amazing songs for their Guitar Hero sessions. 
      Give tips on timing, rhythm, and how to shred. 
      Keep it high-energy and encouraging.`,
    },
  });
}
