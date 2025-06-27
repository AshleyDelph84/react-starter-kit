# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Development server with HMR
npm run dev

# Production build
npm run build

# Start production server
npm run start

# TypeScript type checking
npm run typecheck

# Initialize Convex backend
npx convex dev
```

## Architecture Overview

This is a modern SaaS starter kit built with React Router v7, featuring:

- **Frontend**: React Router v7 with TypeScript, TailwindCSS v4, shadcn/ui components
- **Backend**: Convex real-time database with serverless functions
- **Authentication**: Clerk with automatic user synchronization
- **Payments**: Polar.sh subscription billing with webhook handling
- **AI**: OpenAI integration for chat functionality
- **Deployment**: Optimized for Vercel with Docker support

## Key Architecture Patterns

### Authentication Flow
- Uses Clerk for authentication with `@clerk/react-router`
- Root loader handles auth with `rootAuthLoader`
- User data synchronized in Convex via `convex/users.ts`
- Protected routes use loader-based auth checks

### Database Schema (Convex)
- `users`: Stores user profile data with `tokenIdentifier` index
- `subscriptions`: Tracks Polar.sh subscription status with `userId` and `polarId` indexes
- `webhookEvents`: Logs all webhook events for audit trail

### Subscription Management
- Polar.sh integration handles billing and payments
- Webhooks at `/webhook/polar` update subscription status in real-time
- Subscription status checked via `checkUserSubscriptionStatus` query
- Customer portal access via `createCustomerPortalUrl` action

### Route Structure
- `/` - Homepage with dynamic pricing from Polar.sh
- `/dashboard/*` - Protected dashboard with layout wrapper
- `/dashboard/chat` - AI chat interface using OpenAI
- Authentication routes: `/sign-in/*`, `/sign-up/*`
- Billing: `/pricing`, `/success`, `/subscription-required`

### Component Organization
- `app/components/ui/` - shadcn/ui base components
- `app/components/homepage/` - Landing page sections
- `app/components/dashboard/` - Dashboard-specific components
- `app/components/logos/` - Brand logo components

### Environment Variables
Essential for development:
- `CONVEX_DEPLOYMENT` & `VITE_CONVEX_URL` - Convex backend
- `VITE_CLERK_PUBLISHABLE_KEY` & `CLERK_SECRET_KEY` - Authentication
- `POLAR_ACCESS_TOKEN`, `POLAR_ORGANIZATION_ID`, `POLAR_WEBHOOK_SECRET` - Billing
- `OPENAI_API_KEY` - AI chat features
- `FRONTEND_URL` - Base URL for redirects

## Key Files to Understand

- `app/root.tsx` - App shell with providers (Clerk, Convex, Analytics)
- `app/routes.ts` - Route configuration using React Router v7 patterns
- `convex/schema.ts` - Database schema definition
- `convex/subscriptions.ts` - Subscription logic and webhook handling
- `convex/users.ts` - User management functions
- `react-router.config.ts` - Build configuration with Vercel preset

## Development Notes

- Uses React v19 with latest React Router v7 patterns
- TailwindCSS v4 with utility-first approach
- Real-time updates via Convex subscriptions
- Webhook validation uses custom implementation due to Convex runtime limitations
- AI chat uses streaming responses with `ai` package
- Components follow shadcn/ui patterns with Radix UI primitives