/**
 * Ephemeral token service for Gemini Live API authentication
 * 
 * This service generates short-lived tokens that allow client-side access
 * to the Gemini Live API proxy without exposing the main API key.
 * Tokens are used for secure session authentication and have usage limits.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Token configuration
const TOKEN_EXPIRATION_MINUTES = 60; // 1 hour
const MAX_SESSIONS_PER_TOKEN = 5; // Maximum concurrent sessions per token
const MAX_MESSAGES_PER_TOKEN = 1000; // Maximum messages per token

export interface EphemeralToken {
  token: string;
  userId: string;
  expiresAt: number;
  sessionsUsed: number;
  messagesUsed: number;
  maxSessions: number;
  maxMessages: number;
  isActive: boolean;
}

/**
 * Generate a secure random token
 */
function generateSecureToken(): string {
  // Generate a cryptographically secure random token
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(32);
  
  // Use crypto.getRandomValues for secure randomness
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < randomValues.length; i++) {
      result += chars[randomValues[i] % chars.length];
    }
  } else {
    // Fallback for environments without crypto API
    for (let i = 0; i < 32; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  
  return `glt_${result}_${Date.now()}`;
}

/**
 * Generate a new ephemeral token for a user
 */
export const generateEphemeralToken = mutation({
  args: {
    userId: v.string(),
    maxSessions: v.optional(v.number()),
    maxMessages: v.optional(v.number()),
    expirationMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId, maxSessions, maxMessages, expirationMinutes } = args;
    
    // Check if user exists (userId can be either tokenIdentifier or actual userId)
    let user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", userId))
      .first();
    
    // If not found by tokenIdentifier, the userId might be the actual tokenIdentifier
    // In this case, we already searched correctly above
    
    if (!user) {
      throw new Error("User not found");
    }
    
    // Calculate expiration time
    const expirationTime = expirationMinutes || TOKEN_EXPIRATION_MINUTES;
    const expiresAt = Date.now() + (expirationTime * 60 * 1000);
    
    // Generate secure token
    const token = generateSecureToken();
    
    // Create token record
    const tokenId = await ctx.db.insert("ephemeralTokens", {
      token,
      userId,
      expiresAt,
      sessionsUsed: 0,
      messagesUsed: 0,
      maxSessions: maxSessions || MAX_SESSIONS_PER_TOKEN,
      maxMessages: maxMessages || MAX_MESSAGES_PER_TOKEN,
      isActive: true,
      createdAt: Date.now(),
      lastUsed: Date.now(),
    });
    
    return {
      token,
      expiresAt,
      maxSessions: maxSessions || MAX_SESSIONS_PER_TOKEN,
      maxMessages: maxMessages || MAX_MESSAGES_PER_TOKEN,
      tokenId,
    };
  },
});

/**
 * Validate an ephemeral token
 */
export const validateEphemeralToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;
    
    // Find token in database
    const tokenRecord = await ctx.db
      .query("ephemeralTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    
    if (!tokenRecord) {
      return {
        isValid: false,
        error: "Token not found",
      };
    }
    
    // Check if token is active
    if (!tokenRecord.isActive) {
      return {
        isValid: false,
        error: "Token is deactivated",
      };
    }
    
    // Check expiration
    if (Date.now() > tokenRecord.expiresAt) {
      return {
        isValid: false,
        error: "Token expired",
      };
    }
    
    // Check session limits
    if (tokenRecord.sessionsUsed >= tokenRecord.maxSessions) {
      return {
        isValid: false,
        error: "Session limit exceeded",
      };
    }
    
    // Check message limits
    if (tokenRecord.messagesUsed >= tokenRecord.maxMessages) {
      return {
        isValid: false,
        error: "Message limit exceeded",
      };
    }
    
    return {
      isValid: true,
      userId: tokenRecord.userId,
      sessionsUsed: tokenRecord.sessionsUsed,
      messagesUsed: tokenRecord.messagesUsed,
      maxSessions: tokenRecord.maxSessions,
      maxMessages: tokenRecord.maxMessages,
      expiresAt: tokenRecord.expiresAt,
    };
  },
});

/**
 * Update token usage (increment session or message count)
 */
export const updateTokenUsage = mutation({
  args: {
    token: v.string(),
    incrementSessions: v.optional(v.number()),
    incrementMessages: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { token, incrementSessions = 0, incrementMessages = 0 } = args;
    
    // Find token
    const tokenRecord = await ctx.db
      .query("ephemeralTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    
    if (!tokenRecord) {
      throw new Error("Token not found");
    }
    
    // Update usage counts
    const newSessionsUsed = tokenRecord.sessionsUsed + incrementSessions;
    const newMessagesUsed = tokenRecord.messagesUsed + incrementMessages;
    
    await ctx.db.patch(tokenRecord._id, {
      sessionsUsed: newSessionsUsed,
      messagesUsed: newMessagesUsed,
      lastUsed: Date.now(),
    });
    
    return {
      sessionsUsed: newSessionsUsed,
      messagesUsed: newMessagesUsed,
      maxSessions: tokenRecord.maxSessions,
      maxMessages: tokenRecord.maxMessages,
    };
  },
});

/**
 * Refresh/extend an existing token
 */
export const refreshEphemeralToken = mutation({
  args: {
    token: v.string(),
    additionalMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { token, additionalMinutes = TOKEN_EXPIRATION_MINUTES } = args;
    
    // Find token
    const tokenRecord = await ctx.db
      .query("ephemeralTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    
    if (!tokenRecord) {
      throw new Error("Token not found");
    }
    
    if (!tokenRecord.isActive) {
      throw new Error("Cannot refresh inactive token");
    }
    
    // Extend expiration time
    const newExpiresAt = Math.max(
      Date.now() + (additionalMinutes * 60 * 1000),
      tokenRecord.expiresAt + (additionalMinutes * 60 * 1000)
    );
    
    await ctx.db.patch(tokenRecord._id, {
      expiresAt: newExpiresAt,
      lastUsed: Date.now(),
    });
    
    return {
      token,
      expiresAt: newExpiresAt,
      sessionsUsed: tokenRecord.sessionsUsed,
      messagesUsed: tokenRecord.messagesUsed,
    };
  },
});

/**
 * Deactivate an ephemeral token
 */
export const deactivateEphemeralToken = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const { token } = args;
    
    // Find token
    const tokenRecord = await ctx.db
      .query("ephemeralTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    
    if (!tokenRecord) {
      throw new Error("Token not found");
    }
    
    // Deactivate token
    await ctx.db.patch(tokenRecord._id, {
      isActive: false,
      deactivatedAt: Date.now(),
    });
    
    return {
      success: true,
      token,
    };
  },
});

/**
 * Get all tokens for a user (for admin/debugging purposes)
 */
export const getUserTokens = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = args;
    
    const tokens = await ctx.db
      .query("ephemeralTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    
    return tokens.map(token => ({
      token: token.token.substring(0, 12) + "...", // Hide full token for security
      isActive: token.isActive,
      expiresAt: token.expiresAt,
      sessionsUsed: token.sessionsUsed,
      messagesUsed: token.messagesUsed,
      maxSessions: token.maxSessions,
      maxMessages: token.maxMessages,
      createdAt: token.createdAt,
      lastUsed: token.lastUsed,
    }));
  },
});

/**
 * Clean up expired tokens (should be run periodically)
 */
export const cleanupExpiredTokens = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    
    // Find all expired tokens
    const expiredTokens = await ctx.db
      .query("ephemeralTokens")
      .filter((q) => q.or(
        q.lt(q.field("expiresAt"), now),
        q.eq(q.field("isActive"), false)
      ))
      .collect();
    
    // Delete expired tokens
    const deletePromises = expiredTokens.map(token => 
      ctx.db.delete(token._id)
    );
    
    await Promise.all(deletePromises);
    
    return {
      cleaned: expiredTokens.length,
      timestamp: now,
    };
  },
});