
export interface TranscriptionItem {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export enum SessionStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export interface MathTopic {
  id: string;
  title: string;
  description: string;
  icon: string;
}
