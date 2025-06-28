import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import { GoogleGenAI, Modality } from "@google/genai";

/**
 * WebSocket proxy for Gemini Live API
 * 
 * This handles server-to-server connections for security since Gemini Live API
 * requires server-side authentication. Client connects to this endpoint, and we
 * proxy the connection to Gemini's WebSocket API.
 */

interface GeminiSession {
  sessionId: string;
  userId: string;
  geminiConnection: any;
  isActive: boolean;
  createdAt: number;
  lastActivity: number;
}

// In-memory session store (in production, use a proper cache like Redis)
const activeSessions = new Map<string, GeminiSession>();

// Travel functions for Gemini to call
const travelFunctions = [
  {
    name: "search_flights",
    description: "Search for flights based on user criteria with intelligent comparison from multiple sources",
    behavior: "NON_BLOCKING" as const,
    parameters: {
      type: "object",
      properties: {
        origin: {
          type: "string",
          description: "Departure city or airport code (IATA format like 'NYC', 'JFK', 'New York')"
        },
        destination: {
          type: "string", 
          description: "Arrival city or airport code (IATA format like 'LAX', 'Los Angeles')"
        },
        departure_date: {
          type: "string",
          description: "Departure date in YYYY-MM-DD format"
        },
        return_date: {
          type: "string",
          description: "Optional return date for round-trip searches in YYYY-MM-DD format"
        },
        passengers: {
          type: "integer",
          default: 1,
          minimum: 1,
          maximum: 9,
          description: "Number of passengers"
        },
        cabin_class: {
          type: "string",
          enum: ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"],
          default: "ECONOMY",
          description: "Preferred cabin class"
        },
        max_price: {
          type: "number",
          description: "Maximum price per person in USD"
        },
        direct_flights_only: {
          type: "boolean",
          default: false,
          description: "Search only direct flights"
        }
      },
      required: ["origin", "destination", "departure_date"]
    }
  },
  {
    name: "search_hotels",
    description: "Search for hotels based on location and dates",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "City or location for hotel search"
        },
        check_in: {
          type: "string",
          description: "Check-in date in YYYY-MM-DD format"
        },
        check_out: {
          type: "string",
          description: "Check-out date in YYYY-MM-DD format"
        },
        guests: {
          type: "integer",
          default: 2,
          minimum: 1,
          maximum: 8,
          description: "Number of guests"
        },
        price_range: {
          type: "object",
          properties: {
            min: { type: "number", description: "Minimum price per night" },
            max: { type: "number", description: "Maximum price per night" }
          }
        },
        star_rating: {
          type: "integer",
          minimum: 1,
          maximum: 5,
          description: "Minimum star rating"
        }
      },
      required: ["location", "check_in", "check_out"]
    }
  },
  {
    name: "compare_options",
    description: "Compare flight or hotel options and provide recommendations",
    parameters: {
      type: "object",
      properties: {
        options_type: {
          type: "string",
          enum: ["flights", "hotels"],
          description: "Type of options to compare"
        },
        criteria: {
          type: "object",
          properties: {
            priority: {
              type: "string", 
              enum: ["price", "duration", "convenience", "quality"],
              description: "Main comparison criteria"
            },
            budget_conscious: {
              type: "boolean",
              description: "Prioritize budget-friendly options"
            }
          }
        }
      },
      required: ["options_type"]
    }
  }
];

/**
 * Initialize Gemini Live API connection with travel-specific configuration
 */
async function createGeminiConnection(sessionId: string, userId: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Configure for voice travel agent
  const config = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: `You are a helpful voice travel assistant. You help users find and book flights and hotels. 

Key guidelines:
- Be conversational and friendly in your voice responses
- Ask clarifying questions to understand travel preferences
- Use the available search functions to find real options
- Provide clear recommendations with reasons
- Help compare options based on user priorities (price, convenience, time)
- Be concise but informative in your voice responses
- Always confirm important details before proceeding

You have access to both flight and hotel search capabilities that can find real-time pricing and availability.`,
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: "Aoede" // Friendly, professional voice
        }
      }
    },
    tools: [{ functionDeclarations: travelFunctions }],
    enableAffectiveDialog: true, // Emotion-aware responses
    proactivity: { proactiveAudio: true } // Can decide when to respond
  };

  try {
    const session = await ai.live.connect({
      model: "gemini-2.5-flash-preview-native-audio-dialog",
      config,
      callbacks: {
        onopen: () => {
          console.log(`[${sessionId}] Gemini Live session opened for user ${userId}`);
        },
        onmessage: (message) => {
          console.log(`[${sessionId}] Received from Gemini:`, JSON.stringify(message, null, 2));
          
          // Update last activity
          const sessionData = activeSessions.get(sessionId);
          if (sessionData) {
            sessionData.lastActivity = Date.now();
          }
        },
        onerror: (error) => {
          console.error(`[${sessionId}] Gemini Live error:`, error);
          
          // Mark session as inactive
          const sessionData = activeSessions.get(sessionId);
          if (sessionData) {
            sessionData.isActive = false;
          }
        },
        onclose: (closeEvent) => {
          console.log(`[${sessionId}] Gemini Live session closed:`, closeEvent.reason);
          
          // Clean up session
          activeSessions.delete(sessionId);
        }
      }
    });

    return session;
  } catch (error) {
    console.error(`[${sessionId}] Failed to create Gemini connection:`, error);
    throw error;
  }
}

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
  return `gemini-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Clean up inactive sessions (called periodically)
 */
function cleanupInactiveSessions() {
  const now = Date.now();
  const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

  for (const [sessionId, session] of activeSessions) {
    if (now - session.lastActivity > TIMEOUT_MS) {
      console.log(`[${sessionId}] Cleaning up inactive session`);
      
      try {
        if (session.geminiConnection && session.isActive) {
          session.geminiConnection.close();
        }
      } catch (error) {
        console.error(`[${sessionId}] Error closing connection during cleanup:`, error);
      }
      
      activeSessions.delete(sessionId);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupInactiveSessions, 5 * 60 * 1000);

/**
 * HTTP action to handle Gemini Live API proxy requests
 * 
 * Since Convex doesn't support native WebSockets, this endpoint handles
 * HTTP requests that manage Gemini Live API sessions
 */
export const geminiLiveProxy = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const sessionId = url.searchParams.get("sessionId");

  // Set CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "http://localhost:5173",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    switch (action) {
      case "create_session": {
        // Create new Gemini Live session
        const { userId, ephemeralToken } = await request.json();
        
        if (!userId) {
          return new Response(
            JSON.stringify({ error: "userId is required" }),
            { status: 400, headers: corsHeaders }
          );
        }

        // Validate ephemeral token if provided
        if (ephemeralToken) {
          const tokenValidation = await ctx.runQuery(api.tokens.validateEphemeralToken, {
            token: ephemeralToken
          });
          
          if (!tokenValidation.isValid) {
            return new Response(
              JSON.stringify({ error: `Token validation failed: ${tokenValidation.error}` }),
              { status: 403, headers: corsHeaders }
            );
          }
          
          // Update token usage - increment session count
          await ctx.runMutation(api.tokens.updateTokenUsage, {
            token: ephemeralToken,
            incrementSessions: 1
          });
        }

        const newSessionId = generateSessionId();
        
        try {
          const geminiConnection = await createGeminiConnection(newSessionId, userId);
          
          const sessionData: GeminiSession = {
            sessionId: newSessionId,
            userId,
            geminiConnection,
            isActive: true,
            createdAt: Date.now(),
            lastActivity: Date.now()
          };
          
          activeSessions.set(newSessionId, sessionData);
          
          return new Response(
            JSON.stringify({ 
              sessionId: newSessionId,
              status: "connected",
              model: "gemini-2.5-flash-preview-native-audio-dialog"
            }),
            { headers: corsHeaders }
          );
        } catch (error) {
          console.error("Failed to create Gemini session:", error);
          return new Response(
            JSON.stringify({ error: "Failed to create session" }),
            { status: 500, headers: corsHeaders }
          );
        }
      }

      case "send_message": {
        // Send message to Gemini
        if (!sessionId) {
          return new Response(
            JSON.stringify({ error: "sessionId is required" }),
            { status: 400, headers: corsHeaders }
          );
        }

        const sessionData = activeSessions.get(sessionId);
        if (!sessionData || !sessionData.isActive) {
          return new Response(
            JSON.stringify({ error: "Session not found or inactive" }),
            { status: 404, headers: corsHeaders }
          );
        }

        const { message, messageType = "text", ephemeralToken } = await request.json();
        
        // Validate ephemeral token if provided and update message count
        if (ephemeralToken) {
          const tokenValidation = await ctx.runQuery(api.tokens.validateEphemeralToken, {
            token: ephemeralToken
          });
          
          if (!tokenValidation.isValid) {
            return new Response(
              JSON.stringify({ error: `Token validation failed: ${tokenValidation.error}` }),
              { status: 403, headers: corsHeaders }
            );
          }
          
          // Update token usage - increment message count
          await ctx.runMutation(api.tokens.updateTokenUsage, {
            token: ephemeralToken,
            incrementMessages: 1
          });
        }
        
        try {
          if (messageType === "text") {
            sessionData.geminiConnection.sendClientContent({
              turns: [{ role: "user", parts: [{ text: message }] }],
              turnComplete: true
            });
          } else if (messageType === "audio") {
            sessionData.geminiConnection.sendRealtimeInput({
              audio: {
                data: message.audioData,
                mimeType: message.mimeType || "audio/pcm;rate=16000"
              }
            });
          }
          
          sessionData.lastActivity = Date.now();
          
          return new Response(
            JSON.stringify({ status: "message_sent" }),
            { headers: corsHeaders }
          );
        } catch (error) {
          console.error(`[${sessionId}] Error sending message:`, error);
          return new Response(
            JSON.stringify({ error: "Failed to send message" }),
            { status: 500, headers: corsHeaders }
          );
        }
      }

      case "close_session": {
        // Close Gemini session
        if (!sessionId) {
          return new Response(
            JSON.stringify({ error: "sessionId is required" }),
            { status: 400, headers: corsHeaders }
          );
        }

        const sessionData = activeSessions.get(sessionId);
        if (sessionData) {
          try {
            sessionData.geminiConnection.close();
            sessionData.isActive = false;
          } catch (error) {
            console.error(`[${sessionId}] Error closing session:`, error);
          }
          
          activeSessions.delete(sessionId);
        }
        
        return new Response(
          JSON.stringify({ status: "session_closed" }),
          { headers: corsHeaders }
        );
      }

      case "session_status": {
        // Check session status
        if (!sessionId) {
          return new Response(
            JSON.stringify({ error: "sessionId is required" }),
            { status: 400, headers: corsHeaders }
          );
        }

        const sessionData = activeSessions.get(sessionId);
        
        return new Response(
          JSON.stringify({
            sessionId,
            isActive: sessionData?.isActive || false,
            lastActivity: sessionData?.lastActivity,
            userId: sessionData?.userId
          }),
          { headers: corsHeaders }
        );
      }

      case "list_sessions": {
        // List active sessions (for debugging/monitoring)
        const sessions = Array.from(activeSessions.values()).map(session => ({
          sessionId: session.sessionId,
          userId: session.userId,
          isActive: session.isActive,
          createdAt: session.createdAt,
          lastActivity: session.lastActivity
        }));
        
        return new Response(
          JSON.stringify({ sessions, count: sessions.length }),
          { headers: corsHeaders }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: "Invalid action" }),
          { status: 400, headers: corsHeaders }
        );
    }
  } catch (error) {
    console.error("Gemini Live proxy error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: corsHeaders }
    );
  }
});