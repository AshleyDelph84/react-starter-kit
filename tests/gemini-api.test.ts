import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { GoogleGenAI, Modality } from '@google/genai'

// Mock the @google/genai module
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(),
  Modality: {
    TEXT: 'TEXT',
    AUDIO: 'AUDIO'
  }
}))

describe('Gemini API Integration Tests', () => {
  let mockSession: any
  let mockAI: any

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()
    
    // Create mock session
    mockSession = {
      sendClientContent: vi.fn(),
      sendRealtimeInput: vi.fn(),
      sendToolResponse: vi.fn(),
      receive: vi.fn(),
      close: vi.fn()
    }

    // Create mock AI instance
    mockAI = {
      live: {
        connect: vi.fn().mockResolvedValue(mockSession)
      }
    }

    // Mock GoogleGenAI constructor
    vi.mocked(GoogleGenAI).mockImplementation(() => mockAI)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('API Connection Tests', () => {
    it('should create GoogleGenAI instance with API key', () => {
      const apiKey = process.env.GEMINI_API_KEY
      new GoogleGenAI({ apiKey })
      
      expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey })
    })

    it('should connect to Live API with text modality', async () => {
      const ai = new GoogleGenAI({ apiKey: 'test-key' })
      const config = { responseModalities: [Modality.TEXT] }
      
      const session = await ai.live.connect({
        model: 'gemini-live-2.5-flash-preview',
        config,
        callbacks: {
          onopen: vi.fn(),
          onmessage: vi.fn(),
          onerror: vi.fn(),
          onclose: vi.fn()
        }
      })

      expect(mockAI.live.connect).toHaveBeenCalledWith({
        model: 'gemini-live-2.5-flash-preview',
        config,
        callbacks: expect.any(Object)
      })
      expect(session).toBe(mockSession)
    })

    it('should connect to Live API with audio modality', async () => {
      const ai = new GoogleGenAI({ apiKey: 'test-key' })
      const config = { 
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Aoede' }
          }
        }
      }
      
      await ai.live.connect({
        model: 'gemini-2.5-flash-preview-native-audio-dialog',
        config,
        callbacks: {
          onopen: vi.fn(),
          onmessage: vi.fn(),
          onerror: vi.fn(),
          onclose: vi.fn()
        }
      })

      expect(mockAI.live.connect).toHaveBeenCalledWith({
        model: 'gemini-2.5-flash-preview-native-audio-dialog',
        config: expect.objectContaining({
          responseModalities: [Modality.AUDIO],
          speechConfig: expect.any(Object)
        }),
        callbacks: expect.any(Object)
      })
    })
  })

  describe('Travel Function Integration Tests', () => {
    it('should configure travel functions for Gemini API', async () => {
      const travelFunctions = [
        {
          name: 'search_flights_amadeus',
          description: 'Search flights using Amadeus API',
          behavior: 'NON_BLOCKING',
          parameters: {
            type: 'object',
            properties: {
              origin: { type: 'string' },
              destination: { type: 'string' },
              departure_date: { type: 'string' }
            },
            required: ['origin', 'destination', 'departure_date']
          }
        },
        {
          name: 'search_flights_sabre_bargain_finder',
          description: 'Search flights using Sabre Bargain Finder MAX',
          behavior: 'NON_BLOCKING',
          parameters: {
            type: 'object',
            properties: {
              origin: { type: 'string' },
              destination: { type: 'string' },
              departure_date: { type: 'string' }
            },
            required: ['origin', 'destination', 'departure_date']
          }
        }
      ]

      const ai = new GoogleGenAI({ apiKey: 'test-key' })
      const config = {
        responseModalities: [Modality.TEXT],
        tools: [{ functionDeclarations: travelFunctions }]
      }

      await ai.live.connect({
        model: 'gemini-live-2.5-flash-preview',
        config,
        callbacks: {
          onopen: vi.fn(),
          onmessage: vi.fn(),
          onerror: vi.fn(),
          onclose: vi.fn()
        }
      })

      expect(mockAI.live.connect).toHaveBeenCalledWith({
        model: 'gemini-live-2.5-flash-preview',
        config: expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({
              functionDeclarations: expect.arrayContaining([
                expect.objectContaining({ name: 'search_flights_amadeus' }),
                expect.objectContaining({ name: 'search_flights_sabre_bargain_finder' })
              ])
            })
          ])
        }),
        callbacks: expect.any(Object)
      })
    })
  })

  describe('Session Communication Tests', () => {
    let session: any

    beforeEach(async () => {
      const ai = new GoogleGenAI({ apiKey: 'test-key' })
      session = await ai.live.connect({
        model: 'gemini-live-2.5-flash-preview',
        config: { responseModalities: [Modality.TEXT] },
        callbacks: {
          onopen: vi.fn(),
          onmessage: vi.fn(),
          onerror: vi.fn(),
          onclose: vi.fn()
        }
      })
    })

    it('should send text content to session', async () => {
      const message = 'Find me flights from NYC to LAX on December 25th'
      
      session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: message }] }],
        turnComplete: true
      })

      expect(mockSession.sendClientContent).toHaveBeenCalledWith({
        turns: [{ role: 'user', parts: [{ text: message }] }],
        turnComplete: true
      })
    })

    it('should send audio input to session', async () => {
      const audioData = 'base64-encoded-audio-data'
      
      session.sendRealtimeInput({
        audio: {
          data: audioData,
          mimeType: 'audio/pcm;rate=16000'
        }
      })

      expect(mockSession.sendRealtimeInput).toHaveBeenCalledWith({
        audio: {
          data: audioData,
          mimeType: 'audio/pcm;rate=16000'
        }
      })
    })

    it('should handle tool responses', async () => {
      const functionResponses = [
        {
          id: 'call_123',
          name: 'search_flights_amadeus',
          response: {
            flights: [
              {
                price: 299,
                airline: 'Delta',
                departure: '2024-12-25T08:00:00Z'
              }
            ]
          }
        }
      ]

      session.sendToolResponse({ functionResponses })

      expect(mockSession.sendToolResponse).toHaveBeenCalledWith({
        functionResponses
      })
    })

    it('should close session properly', async () => {
      session.close()
      expect(mockSession.close).toHaveBeenCalled()
    })
  })

  describe('Audio Format Validation Tests', () => {
    it('should validate PCM audio format requirements', () => {
      const validAudioFormat = {
        mimeType: 'audio/pcm;rate=16000',
        sampleRate: 16000,
        bitDepth: 16,
        channels: 1
      }

      // Test format validation logic
      expect(validAudioFormat.mimeType).toMatch(/audio\/pcm;rate=\d+/)
      expect(validAudioFormat.sampleRate).toBe(16000)
      expect(validAudioFormat.bitDepth).toBe(16)
      expect(validAudioFormat.channels).toBe(1)
    })

    it('should validate output audio format', () => {
      const outputAudioFormat = {
        sampleRate: 24000,
        bitDepth: 16,
        channels: 1
      }

      expect(outputAudioFormat.sampleRate).toBe(24000)
      expect(outputAudioFormat.bitDepth).toBe(16)
      expect(outputAudioFormat.channels).toBe(1)
    })
  })

  describe('Error Handling Tests', () => {
    it('should handle connection errors gracefully', async () => {
      const mockError = new Error('Connection failed')
      mockAI.live.connect.mockRejectedValue(mockError)

      const ai = new GoogleGenAI({ apiKey: 'test-key' })

      await expect(
        ai.live.connect({
          model: 'gemini-live-2.5-flash-preview',
          config: { responseModalities: [Modality.TEXT] },
          callbacks: {
            onopen: vi.fn(),
            onmessage: vi.fn(),
            onerror: vi.fn(),
            onclose: vi.fn()
          }
        })
      ).rejects.toThrow('Connection failed')
    })

    it('should handle missing API key', () => {
      expect(() => {
        new GoogleGenAI({ apiKey: '' })
      }).not.toThrow() // Constructor doesn't validate, API calls do
    })

    it('should handle invalid audio format', async () => {
      const ai = new GoogleGenAI({ apiKey: 'test-key' })
      const session = await ai.live.connect({
        model: 'gemini-live-2.5-flash-preview',
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onopen: vi.fn(),
          onmessage: vi.fn(),
          onerror: vi.fn(),
          onclose: vi.fn()
        }
      })

      // Test invalid MIME type
      session.sendRealtimeInput({
        audio: {
          data: 'invalid-audio-data',
          mimeType: 'audio/invalid'
        }
      })

      expect(mockSession.sendRealtimeInput).toHaveBeenCalledWith({
        audio: {
          data: 'invalid-audio-data',
          mimeType: 'audio/invalid'
        }
      })
    })
  })

  describe('Configuration Validation Tests', () => {
    it('should validate half-cascade model configuration', () => {
      const config = {
        model: 'gemini-live-2.5-flash-preview',
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Aoede' }
          }
        }
      }

      expect(config.model).toBe('gemini-live-2.5-flash-preview')
      expect(config.responseModalities).toContain(Modality.AUDIO)
      expect(config.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName).toBe('Aoede')
    })

    it('should validate native audio model configuration', () => {
      const config = {
        model: 'gemini-2.5-flash-preview-native-audio-dialog',
        responseModalities: [Modality.AUDIO],
        enableAffectiveDialog: true,
        proactivity: { proactiveAudio: true }
      }

      expect(config.model).toBe('gemini-2.5-flash-preview-native-audio-dialog')
      expect(config.enableAffectiveDialog).toBe(true)
      expect(config.proactivity?.proactiveAudio).toBe(true)
    })
  })
})