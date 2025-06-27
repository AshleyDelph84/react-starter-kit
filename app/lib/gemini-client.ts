/**
 * Client-side utility for interacting with the Gemini Live API proxy
 * 
 * This handles the communication between the React frontend and our
 * Convex-based Gemini Live API proxy server.
 */

export interface GeminiSession {
  sessionId: string;
  status: string;
  model: string;
}

export interface GeminiMessage {
  type: 'text' | 'audio';
  content: string;
  audioData?: string;
  mimeType?: string;
}

export interface GeminiResponse {
  type: 'text' | 'audio' | 'function_call';
  content?: string;
  audioData?: string;
  functionCall?: {
    name: string;
    parameters: any;
    id: string;
  };
  metadata?: {
    tokenCount?: number;
    usage?: any;
  };
}

export class GeminiLiveClient {
  private baseUrl: string;
  private sessionId: string | null = null;
  private userId: string;
  private messageHandlers: Set<(response: GeminiResponse) => void> = new Set();
  private errorHandlers: Set<(error: Error) => void> = new Set();
  private statusHandlers: Set<(status: string) => void> = new Set();
  private pollingInterval: number | null = null;

  constructor(userId: string, baseUrl: string = '/api/gemini-live') {
    this.userId = userId;
    this.baseUrl = baseUrl;
  }

  /**
   * Create a new Gemini Live session
   */
  async createSession(): Promise<GeminiSession> {
    try {
      this.notifyStatus('connecting');
      
      const response = await fetch(`${this.baseUrl}?action=create_session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: this.userId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.statusText}`);
      }

      const session: GeminiSession = await response.json();
      this.sessionId = session.sessionId;
      
      this.notifyStatus('connected');
      
      // Start polling for messages if not already polling
      if (!this.pollingInterval) {
        this.startMessagePolling();
      }
      
      return session;
    } catch (error) {
      this.notifyStatus('error');
      this.notifyError(error as Error);
      throw error;
    }
  }

  /**
   * Send a text message to Gemini
   */
  async sendTextMessage(message: string): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session. Call createSession() first.');
    }

    try {
      const response = await fetch(`${this.baseUrl}?action=send_message&sessionId=${this.sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          messageType: 'text'
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }
    } catch (error) {
      this.notifyError(error as Error);
      throw error;
    }
  }

  /**
   * Send audio data to Gemini
   */
  async sendAudioMessage(audioData: string, mimeType: string = 'audio/pcm;rate=16000'): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session. Call createSession() first.');
    }

    try {
      const response = await fetch(`${this.baseUrl}?action=send_message&sessionId=${this.sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: { audioData, mimeType },
          messageType: 'audio'
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send audio: ${response.statusText}`);
      }

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }
    } catch (error) {
      this.notifyError(error as Error);
      throw error;
    }
  }

  /**
   * Get session status
   */
  async getSessionStatus(): Promise<{
    sessionId: string;
    isActive: boolean;
    lastActivity?: number;
    userId: string;
  }> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    const response = await fetch(`${this.baseUrl}?action=session_status&sessionId=${this.sessionId}`);
    
    if (!response.ok) {
      throw new Error(`Failed to get session status: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Close the current session
   */
  async closeSession(): Promise<void> {
    if (!this.sessionId) {
      return;
    }

    try {
      // Stop polling
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }

      const response = await fetch(`${this.baseUrl}?action=close_session&sessionId=${this.sessionId}`, {
        method: 'POST',
      });

      if (!response.ok) {
        console.warn(`Failed to close session cleanly: ${response.statusText}`);
      }

      this.sessionId = null;
      this.notifyStatus('disconnected');
    } catch (error) {
      console.error('Error closing session:', error);
      this.sessionId = null;
      this.notifyStatus('disconnected');
    }
  }

  /**
   * Start polling for messages from Gemini
   * Since we can't use WebSockets with Convex, we poll for responses
   */
  private startMessagePolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    // Poll every 500ms for responsive voice interaction
    this.pollingInterval = setInterval(async () => {
      if (!this.sessionId) {
        return;
      }

      try {
        const status = await this.getSessionStatus();
        if (!status.isActive) {
          this.notifyStatus('disconnected');
          if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
          }
        }
      } catch (error) {
        // Polling error - session might be dead
        console.warn('Polling error:', error);
        this.notifyError(error as Error);
      }
    }, 500) as unknown as number;
  }

  /**
   * Add a message handler
   */
  onMessage(handler: (response: GeminiResponse) => void): void {
    this.messageHandlers.add(handler);
  }

  /**
   * Remove a message handler
   */
  offMessage(handler: (response: GeminiResponse) => void): void {
    this.messageHandlers.delete(handler);
  }

  /**
   * Add an error handler
   */
  onError(handler: (error: Error) => void): void {
    this.errorHandlers.add(handler);
  }

  /**
   * Remove an error handler
   */
  offError(handler: (error: Error) => void): void {
    this.errorHandlers.delete(handler);
  }

  /**
   * Add a status change handler
   */
  onStatusChange(handler: (status: string) => void): void {
    this.statusHandlers.add(handler);
  }

  /**
   * Remove a status change handler
   */
  offStatusChange(handler: (status: string) => void): void {
    this.statusHandlers.delete(handler);
  }

  /**
   * Check if there's an active session
   */
  get isConnected(): boolean {
    return this.sessionId !== null;
  }

  /**
   * Get current session ID
   */
  get currentSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Notify message handlers
   */
  private notifyMessage(response: GeminiResponse): void {
    this.messageHandlers.forEach(handler => {
      try {
        handler(response);
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    });
  }

  /**
   * Notify error handlers
   */
  private notifyError(error: Error): void {
    this.errorHandlers.forEach(handler => {
      try {
        handler(error);
      } catch (handlerError) {
        console.error('Error in error handler:', handlerError);
      }
    });
  }

  /**
   * Notify status handlers
   */
  private notifyStatus(status: string): void {
    this.statusHandlers.forEach(handler => {
      try {
        handler(status);
      } catch (error) {
        console.error('Error in status handler:', error);
      }
    });
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    this.messageHandlers.clear();
    this.errorHandlers.clear();
    this.statusHandlers.clear();
    
    if (this.sessionId) {
      this.closeSession().catch(console.error);
    }
  }
}