/**
 * Custom hook for managing Gemini Live API ephemeral tokens with Clerk integration
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/react-router';
import { useMutation } from 'convex/react';
import { api } from '~/convex/_generated/api';
import { TokenStorage, AutoTokenManager, type TokenInfo } from '~/lib/token-service';

interface UseGeminiTokenOptions {
  autoRefresh?: boolean;
  maxSessions?: number;
  maxMessages?: number;
  expirationMinutes?: number;
  onTokenGenerated?: (tokenInfo: TokenInfo) => void;
  onTokenRefresh?: (tokenInfo: TokenInfo) => void;
  onError?: (error: Error) => void;
}

interface UseGeminiTokenReturn {
  token: string | null;
  tokenInfo: TokenInfo | null;
  isLoading: boolean;
  error: Error | null;
  generateToken: () => Promise<string>;
  refreshToken: () => Promise<string>;
  clearToken: () => void;
  isTokenValid: boolean;
  timeUntilExpiration: number | null;
}

export function useGeminiToken(options: UseGeminiTokenOptions = {}): UseGeminiTokenReturn {
  const {
    autoRefresh = true,
    maxSessions = 5,
    maxMessages = 1000,
    expirationMinutes = 60,
    onTokenGenerated,
    onTokenRefresh,
    onError,
  } = options;

  const { userId, isSignedIn } = useAuth();
  const generateTokenMutation = useMutation(api.tokens.generateEphemeralToken);
  const refreshTokenMutation = useMutation(api.tokens.refreshEphemeralToken);

  const tokenManagerRef = useRef<AutoTokenManager | null>(null);
  const tokenInfoRef = useRef<TokenInfo | null>(TokenStorage.getTokenInfo());
  const isLoadingRef = useRef(false);
  const errorRef = useRef<Error | null>(null);

  const handleError = useCallback((error: Error) => {
    errorRef.current = error;
    onError?.(error);
    console.error('Gemini token error:', error);
  }, [onError]);

  const generateToken = useCallback(async (): Promise<string> => {
    if (!isSignedIn || !userId) {
      throw new Error('User must be signed in to generate ephemeral token');
    }

    isLoadingRef.current = true;
    errorRef.current = null;

    try {
      const tokenInfo = await generateTokenMutation({
        userId,
        maxSessions,
        maxMessages,
        expirationMinutes,
      });

      TokenStorage.storeToken(tokenInfo);
      tokenInfoRef.current = tokenInfo;
      onTokenGenerated?.(tokenInfo);

      return tokenInfo.token;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to generate token');
      handleError(err);
      throw err;
    } finally {
      isLoadingRef.current = false;
    }
  }, [isSignedIn, userId, generateTokenMutation, maxSessions, maxMessages, expirationMinutes, onTokenGenerated, handleError]);

  const refreshToken = useCallback(async (): Promise<string> => {
    const currentToken = TokenStorage.getToken();
    if (!currentToken) {
      throw new Error('No token to refresh');
    }

    isLoadingRef.current = true;
    errorRef.current = null;

    try {
      const refreshed = await refreshTokenMutation({
        token: currentToken,
        additionalMinutes: expirationMinutes,
      });

      const newTokenInfo: TokenInfo = {
        token: refreshed.token,
        expiresAt: refreshed.expiresAt,
        maxSessions,
        maxMessages,
        tokenId: tokenInfoRef.current?.tokenId || '',
      };

      TokenStorage.storeToken(newTokenInfo);
      tokenInfoRef.current = newTokenInfo;
      onTokenRefresh?.(newTokenInfo);

      return newTokenInfo.token;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to refresh token');
      handleError(err);
      throw err;
    } finally {
      isLoadingRef.current = false;
    }
  }, [refreshTokenMutation, expirationMinutes, maxSessions, maxMessages, onTokenRefresh, handleError]);

  const clearToken = useCallback(() => {
    TokenStorage.clearToken();
    tokenInfoRef.current = null;
    errorRef.current = null;
    
    if (tokenManagerRef.current) {
      tokenManagerRef.current.destroy();
      tokenManagerRef.current = null;
    }
  }, []);

  // Initialize auto token manager
  useEffect(() => {
    if (!isSignedIn || !autoRefresh) {
      return;
    }

    if (!tokenManagerRef.current) {
      tokenManagerRef.current = new AutoTokenManager(
        generateToken,
        refreshToken,
        {
          onTokenRefresh: (tokenInfo) => {
            tokenInfoRef.current = tokenInfo;
            onTokenRefresh?.(tokenInfo);
          },
        }
      );
    }

    return () => {
      if (tokenManagerRef.current) {
        tokenManagerRef.current.destroy();
        tokenManagerRef.current = null;
      }
    };
  }, [isSignedIn, autoRefresh, generateToken, refreshToken, onTokenRefresh]);

  // Clear token when user signs out
  useEffect(() => {
    if (!isSignedIn) {
      clearToken();
    }
  }, [isSignedIn, clearToken]);

  const currentTokenInfo = tokenInfoRef.current;
  const isTokenValid = currentTokenInfo ? Date.now() < currentTokenInfo.expiresAt : false;
  const timeUntilExpiration = currentTokenInfo 
    ? Math.max(0, Math.floor((currentTokenInfo.expiresAt - Date.now()) / (60 * 1000)))
    : null;

  return {
    token: currentTokenInfo?.token || null,
    tokenInfo: currentTokenInfo,
    isLoading: isLoadingRef.current,
    error: errorRef.current,
    generateToken,
    refreshToken,
    clearToken,
    isTokenValid,
    timeUntilExpiration,
  };
}

/**
 * Hook for ensuring a valid token is available
 * Automatically generates one if needed
 */
export function useEnsureGeminiToken(options: UseGeminiTokenOptions = {}): {
  ensureToken: () => Promise<string>;
  token: string | null;
  isLoading: boolean;
  error: Error | null;
} {
  const tokenHook = useGeminiToken(options);

  const ensureToken = useCallback(async (): Promise<string> => {
    // If we have a valid token, return it
    if (tokenHook.token && tokenHook.isTokenValid) {
      return tokenHook.token;
    }

    // Try to refresh existing token first
    if (tokenHook.token) {
      try {
        return await tokenHook.refreshToken();
      } catch (error) {
        console.warn('Failed to refresh token, generating new one:', error);
      }
    }

    // Generate new token
    return await tokenHook.generateToken();
  }, [tokenHook]);

  return {
    ensureToken,
    token: tokenHook.token,
    isLoading: tokenHook.isLoading,
    error: tokenHook.error,
  };
}