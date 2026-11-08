interface Window {
     VoiceGuide: { init(o: object): void; speakOnce(t: string): Promise<void>; stop(): void };
     QrStart: { open(o?: object): Promise<{ id: string; raw: string } | null>; readStartFromUrl(): string | null };
   }