<<<<<<< Updated upstream
interface Window {
     VoiceGuide: { init(o: object): void; speakOnce(t: string): Promise<void>; stop(): void };
     QrStart: { open(o?: object): Promise<{ id: string; raw: string } | null>; readStartFromUrl(): string | null };
   }
=======
export {};

declare global {
  interface Window {
    QrStart: {
      open: () => Promise<{ id: string; raw: string } | null>;
    };
    VoiceGuide?: {
      speakOnce: (text: string) => void | Promise<void>;
    };
  }
}
>>>>>>> Stashed changes
