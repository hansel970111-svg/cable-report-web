export {};

declare global {
  interface Window {
    cableReport?: {
      getDesktopSessionToken(): Promise<string>;
    };
  }
}
