/**
 * Client-side token service for managing ephemeral tokens
 * 
 * This service handles the generation, validation, and management of ephemeral
 * tokens used for Gemini Live API authentication on the client side.
 */

import { api } from "~/convex/_generated/api";
import { useQuery, useMutation } from "convex/react";
import { useAuth } from "@clerk/react-router";

export interface TokenInfo {
  token: string;
  expiresAt: number;
  maxSessions: number;
  maxMessages: number;
  tokenId: string;
}

export interface TokenValidation {
  isValid: boolean;
  error?: string;
  userId?: string;
  sessionsUsed?: number;
  messagesUsed?: number;
  maxSessions?: number;
  maxMessages?: number;
  expiresAt?: number;
}

export interface TokenUsage {
  sessionsUsed: number;
  messagesUsed: number;
  maxSessions: number;
  maxMessages: number;
}

/**
 * Hook for managing ephemeral tokens
 */
export function useEphemeralToken() {
  const { userId } = useAuth();
  const generateToken = useMutation(api.tokens.generateEphemeralToken);
  const validateToken = useQuery(api.tokens.validateEphemeralToken);
  const updateUsage = useMutation(api.tokens.updateTokenUsage);
  const refreshToken = useMutation(api.tokens.refreshEphemeralToken);
  const deactivateToken = useMutation(api.tokens.deactivateEphemeralToken);
  const getUserTokens = useQuery(api.tokens.getUserTokens);

  /**
   * Generate a new ephemeral token
   */
  const generate = async (options?: {
    maxSessions?: number;
    maxMessages?: number;
    expirationMinutes?: number;
  }): Promise<TokenInfo> => {
    if (!userId) {
      throw new Error("User must be authenticated to generate token");
    }

    return await generateToken({
      userId,
      ...options,
    });
  };

  /**
   * Validate an existing token
   */
  const validate = async (token: string): Promise<TokenValidation> => {
    if (!token) {
      return { isValid: false, error: "Token is required" };
    }

    return validateToken({ token });
  };

  /**
   * Update token usage
   */
  const updateTokenUsage = async (
    token: string,
    options: {
      incrementSessions?: number;
      incrementMessages?: number;
    }
  ): Promise<TokenUsage> => {
    return await updateUsage({
      token,
      ...options,
    });
  };

  /**
   * Refresh/extend token expiration
   */
  const refresh = async (
    token: string,
    additionalMinutes?: number
  ): Promise<{
    token: string;
    expiresAt: number;
    sessionsUsed: number;
    messagesUsed: number;
  }> => {
    return await refreshToken({
      token,
      additionalMinutes,
    });
  };

  /**
   * Deactivate a token
   */
  const deactivate = async (token: string): Promise<{ success: boolean; token: string }> => {
    return await deactivateToken({ token });
  };

  /**
   * Get all tokens for current user
   */
  const getUserTokenList = () => {
    if (!userId) return [];
    return getUserTokens({ userId });
  };

  return {
    generate,
    validate,
    updateTokenUsage,
    refresh,
    deactivate,
    getUserTokens: getUserTokenList,
  };
}

/**
 * Token storage utilities for client-side token management
 */
export class TokenStorage {
  private static readonly TOKEN_KEY = 'gemini_ephemeral_token';
  private static readonly TOKEN_INFO_KEY = 'gemini_token_info';

  /**
   * Store token in localStorage
   */
  static storeToken(tokenInfo: TokenInfo): void {
    if (typeof window === 'undefined') return;

    try {
      localStorage.setItem(this.TOKEN_KEY, tokenInfo.token);
      localStorage.setItem(this.TOKEN_INFO_KEY, JSON.stringify(tokenInfo));
    } catch (error) {
      console.warn('Failed to store ephemeral token:', error);
    }
  }

  /**
   * Retrieve token from localStorage
   */
  static getToken(): string | null {
    if (typeof window === 'undefined') return null;

    try {
      return localStorage.getItem(this.TOKEN_KEY);
    } catch (error) {
      console.warn('Failed to retrieve ephemeral token:', error);
      return null;
    }
  }

  /**
   * Get full token info from localStorage
   */
  static getTokenInfo(): TokenInfo | null {
    if (typeof window === 'undefined') return null;

    try {
      const infoString = localStorage.getItem(this.TOKEN_INFO_KEY);
      if (!infoString) return null;
      
      const info = JSON.parse(infoString) as TokenInfo;
      
      // Check if token is expired
      if (Date.now() > info.expiresAt) {
        this.clearToken();
        return null;
      }
      
      return info;
    } catch (error) {
      console.warn('Failed to retrieve token info:', error);
      this.clearToken();
      return null;
    }
  }

  /**
   * Clear token from localStorage
   */
  static clearToken(): void {
    if (typeof window === 'undefined') return;

    try {
      localStorage.removeItem(this.TOKEN_KEY);
      localStorage.removeItem(this.TOKEN_INFO_KEY);
    } catch (error) {
      console.warn('Failed to clear ephemeral token:', error);
    }
  }

  /**
   * Check if current token is valid (not expired)
   */
  static isTokenValid(): boolean {
    const tokenInfo = this.getTokenInfo();
    return tokenInfo !== null && Date.now() < tokenInfo.expiresAt;
  }

  /**
   * Get time until token expires (in minutes)
   */
  static getTimeUntilExpiration(): number | null {
    const tokenInfo = this.getTokenInfo();
    if (!tokenInfo) return null;

    const msUntilExpiration = tokenInfo.expiresAt - Date.now();
    return Math.max(0, Math.floor(msUntilExpiration / (60 * 1000)));
  }
}

/**
 * Automatic token management class
 */
export class AutoTokenManager {
  private refreshTimer: number | null = null;
  private onTokenRefresh?: (tokenInfo: TokenInfo) => void;

  constructor(
    private generateToken: () => Promise<TokenInfo>,
    private refreshToken: (token: string) => Promise<any>,
    options?: {
      onTokenRefresh?: (tokenInfo: TokenInfo) => void;
    }
  ) {
    this.onTokenRefresh = options?.onTokenRefresh;
  }

  /**
   * Ensure there's a valid token, generating one if needed
   */
  async ensureValidToken(): Promise<string> {
    let tokenInfo = TokenStorage.getTokenInfo();

    // Generate new token if none exists or current is expired
    if (!tokenInfo || Date.now() > tokenInfo.expiresAt) {
      tokenInfo = await this.generateToken();
      TokenStorage.storeToken(tokenInfo);
      this.onTokenRefresh?.(tokenInfo);
    }

    // Set up auto-refresh if not already running
    if (!this.refreshTimer) {
      this.setupAutoRefresh(tokenInfo);
    }

    return tokenInfo.token;
  }

  /**
   * Setup automatic token refresh
   */
  private setupAutoRefresh(tokenInfo: TokenInfo): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    // Refresh 5 minutes before expiration
    const refreshTime = tokenInfo.expiresAt - Date.now() - (5 * 60 * 1000);
    
    if (refreshTime > 0) {
      this.refreshTimer = setTimeout(async () => {
        try {
          const currentToken = TokenStorage.getToken();
          if (currentToken) {
            const refreshed = await this.refreshToken(currentToken);
            const newTokenInfo: TokenInfo = {
              token: refreshed.token,
              expiresAt: refreshed.expiresAt,
              maxSessions: tokenInfo.maxSessions,
              maxMessages: tokenInfo.maxMessages,
              tokenId: tokenInfo.tokenId,
            };
            
            TokenStorage.storeToken(newTokenInfo);
            this.onTokenRefresh?.(newTokenInfo);
            
            // Setup next refresh
            this.setupAutoRefresh(newTokenInfo);
          }
        } catch (error) {
          console.error('Failed to refresh token:', error);
          // Clear invalid token and let ensureValidToken handle regeneration
          TokenStorage.clearToken();
        }
      }, refreshTime) as unknown as number;
    }
  }

  /**
   * Stop automatic token management
   */
  destroy(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}