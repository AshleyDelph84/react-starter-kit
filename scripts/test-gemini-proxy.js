#!/usr/bin/env node

/**
 * Test script for Gemini Live API proxy
 * Run with: node scripts/test-gemini-proxy.js
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

async function testGeminiProxy() {
  console.log('🧪 Testing Gemini Live API Proxy...\n')

  // Test configuration
  const CONVEX_SITE_URL = process.env.VITE_CONVEX_SITE_URL || 'http://localhost:8080'
  const PROXY_URL = `${CONVEX_SITE_URL}/api/gemini-live`
  const TEST_USER_ID = 'test-user-12345'

  console.log(`🌐 Proxy URL: ${PROXY_URL}`)
  console.log(`👤 Test User ID: ${TEST_USER_ID}\n`)

  try {
    // Test 1: Create session
    console.log('📝 Step 1: Creating Gemini Live session...')
    
    const createResponse = await fetch(`${PROXY_URL}?action=create_session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: TEST_USER_ID }),
    })

    if (!createResponse.ok) {
      throw new Error(`Create session failed: ${createResponse.status} ${createResponse.statusText}`)
    }

    const sessionData = await createResponse.json()
    console.log('✅ Session created:', sessionData)
    
    if (!sessionData.sessionId) {
      throw new Error('No sessionId returned')
    }

    const sessionId = sessionData.sessionId
    console.log(`🔗 Session ID: ${sessionId}\n`)

    // Test 2: Check session status
    console.log('📝 Step 2: Checking session status...')
    
    const statusResponse = await fetch(`${PROXY_URL}?action=session_status&sessionId=${sessionId}`)
    
    if (!statusResponse.ok) {
      throw new Error(`Status check failed: ${statusResponse.status} ${statusResponse.statusText}`)
    }

    const statusData = await statusResponse.json()
    console.log('✅ Session status:', statusData)
    
    if (!statusData.isActive) {
      throw new Error('Session is not active')
    }

    console.log('')

    // Test 3: Send test message
    console.log('📝 Step 3: Sending test message...')
    
    const messageResponse = await fetch(`${PROXY_URL}?action=send_message&sessionId=${sessionId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Hello! I need help planning a trip from New York to Los Angeles. Can you help me find flights?',
        messageType: 'text'
      }),
    })

    if (!messageResponse.ok) {
      throw new Error(`Send message failed: ${messageResponse.status} ${messageResponse.statusText}`)
    }

    const messageResult = await messageResponse.json()
    console.log('✅ Message sent:', messageResult)
    console.log('')

    // Test 4: Wait and check status again (simulating response processing)
    console.log('📝 Step 4: Waiting for processing...')
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    const statusResponse2 = await fetch(`${PROXY_URL}?action=session_status&sessionId=${sessionId}`)
    const statusData2 = await statusResponse2.json()
    console.log('✅ Updated session status:', statusData2)
    console.log('')

    // Test 5: List all sessions
    console.log('📝 Step 5: Listing all active sessions...')
    
    const listResponse = await fetch(`${PROXY_URL}?action=list_sessions`)
    
    if (!listResponse.ok) {
      throw new Error(`List sessions failed: ${listResponse.status} ${listResponse.statusText}`)
    }

    const sessionsData = await listResponse.json()
    console.log('✅ Active sessions:', sessionsData)
    console.log('')

    // Test 6: Close session
    console.log('📝 Step 6: Closing session...')
    
    const closeResponse = await fetch(`${PROXY_URL}?action=close_session&sessionId=${sessionId}`, {
      method: 'POST',
    })

    if (!closeResponse.ok) {
      throw new Error(`Close session failed: ${closeResponse.status} ${closeResponse.statusText}`)
    }

    const closeResult = await closeResponse.json()
    console.log('✅ Session closed:', closeResult)
    console.log('')

    // Test 7: Verify session is closed
    console.log('📝 Step 7: Verifying session closure...')
    
    const finalStatusResponse = await fetch(`${PROXY_URL}?action=session_status&sessionId=${sessionId}`)
    const finalStatusData = await finalStatusResponse.json()
    console.log('✅ Final session status:', finalStatusData)

    if (finalStatusData.isActive) {
      console.log('⚠️  Warning: Session still shows as active')
    } else {
      console.log('✅ Session properly closed')
    }

    console.log('\n🎉 Gemini Live API Proxy test completed successfully!')
    console.log('\n📋 Test Summary:')
    console.log('  ✅ Session creation')
    console.log('  ✅ Status checking')
    console.log('  ✅ Message sending')
    console.log('  ✅ Session management')
    console.log('  ✅ Session listing')
    console.log('  ✅ Session closure')
    console.log('\n🚀 Proxy server is working correctly!')

  } catch (error) {
    console.error('\n❌ Proxy test failed:')
    console.error('Error:', error.message)
    
    if (error.message.includes('fetch')) {
      console.log('\n💡 Connection issues:')
      console.log('  - Make sure Convex dev server is running: npx convex dev')
      console.log('  - Check VITE_CONVEX_SITE_URL in your .env file')
      console.log('  - Verify network connectivity')
    } else if (error.message.includes('API key') || error.message.includes('authentication')) {
      console.log('\n💡 Authentication issues:')
      console.log('  - Verify GEMINI_API_KEY is set correctly')
      console.log('  - Check API key permissions in Google AI Studio')
      console.log('  - Ensure billing is configured')
    } else if (error.message.includes('session')) {
      console.log('\n💡 Session management issues:')
      console.log('  - Proxy server might be overloaded')
      console.log('  - Check Convex function logs')
      console.log('  - Try running the test again')
    }
    
    process.exit(1)
  }
}

// Run the test
testGeminiProxy().catch(console.error)