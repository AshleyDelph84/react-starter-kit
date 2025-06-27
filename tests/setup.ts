import { beforeAll, beforeEach } from 'vitest'

// Mock environment variables for testing
beforeAll(() => {
  // Set test environment variables
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-gemini-key'
  process.env.AMADEUS_CLIENT_ID = process.env.AMADEUS_CLIENT_ID || 'test-amadeus-id'
  process.env.AMADEUS_CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET || 'test-amadeus-secret'
  process.env.SABRE_CLIENT_ID = process.env.SABRE_CLIENT_ID || 'test-sabre-id'
  process.env.SABRE_CLIENT_SECRET = process.env.SABRE_CLIENT_SECRET || 'test-sabre-secret'
})

beforeEach(() => {
  // Reset any global state before each test
})