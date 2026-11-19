export {};

declare global {
  interface Window {
    QrStart: {
      open: (options?: object) => Promise<{ id: string; raw: string } | null>;
      readStartFromUrl: () => string | null;
    };
    VoiceGuide?: {
      init: (options: object) => void;
      speakOnce: (text: string) => void | Promise<void>;
      stop: () => void;
    };
  }
}
