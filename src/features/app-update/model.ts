export type DesktopUpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

export type DesktopUpdateState = {
  phase: DesktopUpdatePhase;
  currentVersion: string;
  version?: string;
  percent?: number;
  message?: string;
};

export type DesktopUpdateApi = {
  getUpdateState(): Promise<DesktopUpdateState>;
  checkForUpdates(): Promise<DesktopUpdateState>;
  downloadUpdate(): Promise<DesktopUpdateState>;
  installUpdate(): Promise<DesktopUpdateState>;
  onUpdateState(callback: (state: DesktopUpdateState) => void): () => void;
  onOpenUpdateDialog(callback: () => void): () => void;
};
