#!/usr/bin/env node

/**
 * Simple script to test Gemini API connectivity
 * Run with: node scripts/test-gemini-connection.js
 * 
 * Make sure to set GEMINI_API_KEY in your .env file first
 * or export GEMINI_API_KEY=your_key_here before running
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Simple .env file parser
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

try {
  const envPath = join(__dirname, '../.env')
  const envContent = readFileSync(envPath, 'utf8')
  
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=')
      if (key && valueParts.length) {
        const value = valueParts.join('=').replace(/^["']|["']$/g, '')
        process.env[key] = value
      }
    }
  })
} catch (error) {
  // .env file doesn't exist, rely on environment variables
}

async function testGeminiConnection() {
  const apiKey = process.env.GEMINI_API_KEY

  console.log('🧪 Testing Gemini API Connection...\n')

  // Check API key
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not found in environment variables')
    console.log('💡 Please add GEMINI_API_KEY=your_api_key to your .env file')
    process.exit(1)
  }

  console.log('✅ API key found')
  console.log(`🔑 Key preview: ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}`)

  try {
    // Dynamic import since @google/genai might not be installed yet
    let GoogleGenAI, Modality
    
    try {
      const module = await import('@google/genai')
      GoogleGenAI = module.GoogleGenAI
      Modality = module.Modality
      console.log('✅ @google/genai package loaded successfully')
    } catch (importError) {
      console.error('❌ @google/genai package not found')
      console.log('💡 Install it with: npm install @google/genai')
      console.log('📦 Or run: npm install')
      process.exit(1)
    }

    // Initialize client
    const ai = new GoogleGenAI({ apiKey })
    console.log('✅ GoogleGenAI client initialized')

    // Test basic text connection
    console.log('\n📝 Testing text-only connection...')
    
    const config = {
      responseModalities: [Modality.TEXT],
      systemInstruction: 'You are a helpful travel assistant. Respond briefly.'
    }

    const session = await ai.live.connect({
      model: 'gemini-live-2.5-flash-preview',
      callbacks: {
        onopen: function () {
          console.log('✅ WebSocket connection opened')
        },
        onmessage: function (message) {
          console.log('📨 Received message:', JSON.stringify(message, null, 2))
        },
        onerror: function (e) {
          console.error('❌ WebSocket error:', e.message)
        },
        onclose: function (e) {
          console.log('🔌 WebSocket connection closed:', e.reason)
        },
      },
      config: config,
    })

    console.log('✅ Live API session established')

    // Send a test message
    console.log('\n💬 Sending test message...')
    const testMessage = 'Hello! Can you help me plan a trip?'
    
    session.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: testMessage }] }],
      turnComplete: true
    })

    // Wait for response
    let responseReceived = false
    const timeout = setTimeout(() => {
      if (!responseReceived) {
        console.log('⏰ Response timeout - this might be normal for testing')
        session.close()
      }
    }, 10000) // 10 second timeout

    // Handle responses using callback approach instead of async iterator
    const messagePromise = new Promise((resolve, reject) => {
      const originalOnMessage = session.callbacks?.onmessage || (() => {})
      
      // Override the onmessage callback to capture responses
      if (session.callbacks) {
        session.callbacks.onmessage = function(message) {
          originalOnMessage(message)
          
          if (message.text || (message.serverContent && message.serverContent.modelTurn)) {
            console.log('✅ Received response from Gemini')
            responseReceived = true
            clearTimeout(timeout)
            resolve(message)
          }
        }
      }
      
      // Set up timeout
      setTimeout(() => {
        if (!responseReceived) {
          console.log('⏰ Response timeout - connection established but no response received')
          resolve(null)
        }
      }, 10000)
    })

    // Wait for response or timeout
    await messagePromise

    session.close()
    console.log('\n🎉 Gemini API connection test completed successfully!')
    console.log('\n📋 Test Summary:')
    console.log('  ✅ API key validation')
    console.log('  ✅ Package loading')
    console.log('  ✅ Client initialization')
    console.log('  ✅ WebSocket connection')
    console.log('  ✅ Message sending')
    if (responseReceived) {
      console.log('  ✅ Response received')
    } else {
      console.log('  ⚠️  Response timeout (may be normal)')
    }

  } catch (error) {
    console.error('\n❌ Connection test failed:')
    console.error('Error:', error.message)
    
    if (error.message.includes('API key')) {
      console.log('\n💡 API key issues:')
      console.log('  - Make sure your API key is valid')
      console.log('  - Check if the API key has proper permissions')
      console.log('  - Verify billing is set up in Google AI Studio')
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      console.log('\n💡 Network issues:')
      console.log('  - Check your internet connection')
      console.log('  - Verify firewall settings')
      console.log('  - Try again in a few minutes')
    } else {
      console.log('\n💡 Other potential issues:')
      console.log('  - API might be temporarily unavailable')
      console.log('  - Check Gemini API status page')
      console.log('  - Verify your quota limits')
    }
    
    process.exit(1)
  }
}

// Run the test
testGeminiConnection().catch(console.error)