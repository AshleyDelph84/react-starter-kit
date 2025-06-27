# React Starter Kit - Project Architecture

This document provides a comprehensive overview of the React Starter Kit codebase architecture, service connections, and implementation details.

## Overview

The React Starter Kit is a modern SaaS application built with React Router v7, featuring real-time database capabilities, authentication, subscription billing, and AI chat functionality. It's designed for rapid deployment and scalability.

## Technology Stack

- **Frontend**: React 19 + React Router v7 + TypeScript
- **Styling**: TailwindCSS v4 + shadcn/ui components
- **Backend**: Convex (real-time database + serverless functions)
- **Authentication**: Clerk
- **Payments**: Polar.sh
- **AI**: OpenAI GPT-4o
- **Deployment**: Vercel + Docker support

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Convex        │    │   External      │
│   (React)       │    │   Backend       │    │   Services      │
├─────────────────┤    ├─────────────────┤    ├─────────────────┤
│ • Routes        │◄──►│ • Database      │◄──►│ • Clerk Auth    │
│ • Components    │    │ • Functions     │    │ • Polar.sh      │
│ • Auth Context  │    │ • HTTP Routes   │    │ • OpenAI        │
│ • UI Layer      │    │ • Webhooks      │    │ • Vercel        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Service Connections

### 1. Authentication Flow

The application uses Clerk for authentication with automatic user synchronization to Convex.

#### Key Files:
- `app/root.tsx` - Root providers and auth loader
- `convex/users.ts` - User management functions
- `app/routes/dashboard/layout.tsx` - Protected route handling

#### Authentication Implementation:

```tsx
// app/root.tsx - Auth Provider Setup
export async function loader(args: Route.LoaderArgs) {
  return rootAuthLoader(args);
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    <ClerkProvider
      loaderData={loaderData}
      signUpFallbackRedirectUrl="/"
      signInFallbackRedirectUrl="/"
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <Outlet />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
```

```tsx
// app/routes/dashboard/layout.tsx - Protected Routes
export async function loader(args: Route.LoaderArgs) {
  const { userId } = await getAuth(args);

  // Redirect to sign-in if not authenticated
  if (!userId) {
    throw redirect("/sign-in");
  }

  // Check subscription status
  const subscriptionStatus = await fetchQuery(
    api.subscriptions.checkUserSubscriptionStatus, 
    { userId }
  );

  if (!subscriptionStatus?.hasActiveSubscription) {
    throw redirect("/subscription-required");
  }

  return { user };
}
```

```tsx
// convex/users.ts - User Synchronization
export const upsertUser = mutation({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      return null;
    }

    // Check if user exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.subject))
      .unique();

    if (existingUser) {
      // Update if needed
      if (existingUser.name !== identity.name || existingUser.email !== identity.email) {
        await ctx.db.patch(existingUser._id, {
          name: identity.name,
          email: identity.email,
        });
      }
      return existingUser;
    }

    // Create new user
    const userId = await ctx.db.insert("users", {
      name: identity.name,
      email: identity.email,
      tokenIdentifier: identity.subject,
    });

    return await ctx.db.get(userId);
  },
});
```

### 2. Database Schema & Convex Integration

Convex serves as both the database and serverless function runtime, providing real-time capabilities.

#### Database Schema:

```tsx
// convex/schema.ts - Complete Database Schema
export default defineSchema({
  users: defineTable({
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    image: v.optional(v.string()),
    tokenIdentifier: v.string(),
  }).index("by_token", ["tokenIdentifier"]),

  subscriptions: defineTable({
    userId: v.optional(v.string()),
    polarId: v.optional(v.string()),
    polarPriceId: v.optional(v.string()),
    currency: v.optional(v.string()),
    interval: v.optional(v.string()),
    status: v.optional(v.string()),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    amount: v.optional(v.number()),
    // ... additional subscription fields
  })
    .index("userId", ["userId"])
    .index("polarId", ["polarId"]),

  webhookEvents: defineTable({
    type: v.string(),
    polarEventId: v.string(),
    createdAt: v.string(),
    modifiedAt: v.string(),
    data: v.any(),
  })
    .index("type", ["type"])
    .index("polarEventId", ["polarEventId"]),
});
```

#### Convex Functions:

```tsx
// convex/subscriptions.ts - Subscription Management
export const checkUserSubscriptionStatus = query({
  args: { userId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
      .unique();

    if (!user) {
      return { hasActiveSubscription: false };
    }

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("userId", (q) => q.eq("userId", user.tokenIdentifier))
      .first();

    const hasActiveSubscription = subscription?.status === "active";
    return { hasActiveSubscription };
  },
});
```

### 3. Subscription & Billing Integration

Polar.sh handles subscription billing with real-time webhook updates.

#### Billing Flow:

```tsx
// convex/subscriptions.ts - Checkout Creation
export const createCheckoutSession = action({
  args: { priceId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Ensure user exists
    let user = await ctx.runQuery(api.users.findUserByToken, {
      tokenIdentifier: identity.subject,
    });

    if (!user) {
      user = await ctx.runMutation(api.users.upsertUser);
    }

    const checkout = await createCheckout({
      customerEmail: user.email!,
      productPriceId: args.priceId,
      successUrl: `${process.env.FRONTEND_URL}/success`,
      metadata: { userId: user.tokenIdentifier },
    });

    return checkout.url;
  },
});
```

#### Webhook Processing:

```tsx
// convex/subscriptions.ts - Webhook Handler
export const handleWebhookEvent = mutation({
  args: { body: v.any() },
  handler: async (ctx, args) => {
    const eventType = args.body.type;

    // Store webhook event for audit trail
    await ctx.db.insert("webhookEvents", {
      type: eventType,
      polarEventId: args.body.data.id,
      createdAt: args.body.data.created_at,
      modifiedAt: args.body.data.modified_at || args.body.data.created_at,
      data: args.body.data,
    });

    switch (eventType) {
      case "subscription.created":
        await ctx.db.insert("subscriptions", {
          polarId: args.body.data.id,
          userId: args.body.data.metadata.userId,
          status: args.body.data.status,
          // ... additional fields
        });
        break;

      case "subscription.updated":
        const existingSub = await ctx.db
          .query("subscriptions")
          .withIndex("polarId", (q) => q.eq("polarId", args.body.data.id))
          .first();

        if (existingSub) {
          await ctx.db.patch(existingSub._id, {
            status: args.body.data.status,
            // ... updated fields
          });
        }
        break;
    }
  },
});
```

#### HTTP Routes:

```tsx
// convex/http.ts - Webhook Endpoint
http.route({
  path: "/payments/webhook",
  method: "POST",
  handler: paymentWebhook,
});

export const paymentWebhook = httpAction(async (ctx, request) => {
  const rawBody = await request.text();
  
  // Validate webhook signature
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  validateEvent(rawBody, headers, process.env.POLAR_WEBHOOK_SECRET);

  const body = JSON.parse(rawBody);

  // Process webhook event
  await ctx.runMutation(api.subscriptions.handleWebhookEvent, { body });

  return new Response(JSON.stringify({ message: "Webhook received!" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
```

### 4. AI Chat Integration

OpenAI integration provides streaming chat responses through Convex HTTP endpoints.

#### Chat Implementation:

```tsx
// app/routes/dashboard/chat.tsx - Frontend Chat
export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } =
    useChat({
      maxSteps: 10,
      api: `${CONVEX_SITE_URL}/api/chat`, // Convex HTTP endpoint
    });

  return (
    <div className="flex flex-col w-full py-24 justify-center items-center">
      <div className="w-full max-w-xl space-y-4 mb-20">
        {messages.map((message, i) => (
          <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[65%] px-3 py-1.5 text-sm shadow-sm", /* styling */)}>
              {message.parts.map((part) => (
                part.type === "text" && <Markdown key={`${message.id}-${i}`}>{part.text}</Markdown>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* Chat input form */}
    </div>
  );
}
```

```tsx
// convex/http.ts - Chat Endpoint
export const chat = httpAction(async (ctx, req) => {
  const { messages } = await req.json();

  const result = streamText({
    model: openai("gpt-4o"),
    messages,
    async onFinish({ text }) {
      console.log(text); // Log completion
    },
  });

  return result.toDataStreamResponse({
    headers: {
      "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "http://localhost:5173",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Credentials": "true",
    },
  });
});

http.route({
  path: "/api/chat",
  method: "POST",
  handler: chat,
});
```

### 5. Routing Architecture

React Router v7 provides file-based routing with layout nesting and loader-based data fetching.

#### Route Configuration:

```tsx
// app/routes.ts - Route Definitions
export default [
  index("routes/home.tsx"),
  route("sign-in/*", "routes/sign-in.tsx"),
  route("sign-up/*", "routes/sign-up.tsx"),
  route("pricing", "routes/pricing.tsx"),
  route("success", "routes/success.tsx"),
  route("subscription-required", "routes/subscription-required.tsx"),
  layout("routes/dashboard/layout.tsx", [
    route("dashboard", "routes/dashboard/index.tsx"),
    route("dashboard/chat", "routes/dashboard/chat.tsx"),
    route("dashboard/settings", "routes/dashboard/settings.tsx"),
  ]),
] satisfies RouteConfig;
```

#### Data Loading Pattern:

```tsx
// app/routes/home.tsx - Homepage with Pricing Data
export async function loader(args: Route.LoaderArgs) {
  const { userId } = await getAuth(args);

  // Parallel data fetching to reduce waterfall
  const [subscriptionData, plans] = await Promise.all([
    userId
      ? fetchQuery(api.subscriptions.checkUserSubscriptionStatus, { userId })
      : Promise.resolve(null),
    fetchAction(api.subscriptions.getAvailablePlans),
  ]);

  return {
    isSignedIn: !!userId,
    hasActiveSubscription: subscriptionData?.hasActiveSubscription || false,
    plans,
  };
}
```

## Component Architecture

### UI Components
- **Base**: `app/components/ui/` - shadcn/ui components with Radix UI primitives
- **Homepage**: `app/components/homepage/` - Landing page sections
- **Dashboard**: `app/components/dashboard/` - Dashboard-specific components
- **Logos**: `app/components/logos/` - Brand assets

### Component Example:

```tsx
// Typical component structure following shadcn/ui patterns
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

export function DashboardCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {children}
      </CardContent>
    </Card>
  );
}
```

## Environment Configuration

### Required Environment Variables

```bash
# Convex Backend
CONVEX_DEPLOYMENT=your-deployment-name
VITE_CONVEX_URL=https://your-deployment.convex.cloud

# Authentication (Clerk)
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Payments (Polar.sh)
POLAR_ACCESS_TOKEN=polar_...
POLAR_ORGANIZATION_ID=org_...
POLAR_WEBHOOK_SECRET=whsec_...

# AI Chat (OpenAI)
OPENAI_API_KEY=sk-...

# App Configuration
FRONTEND_URL=http://localhost:5173
```

## Data Flow Patterns

### 1. User Authentication & Subscription Check
```
User Request → Clerk Auth → Convex User Lookup → Subscription Status → Route Access
```

### 2. Subscription Creation
```
User → Checkout Request → Polar.sh API → Checkout URL → Payment → Webhook → Convex DB Update
```

### 3. Real-time Updates
```
Database Change → Convex Subscription → React Component Re-render
```

### 4. AI Chat
```
User Message → Convex HTTP Route → OpenAI API → Streaming Response → Frontend Update
```

## Deployment Architecture

### Vercel Deployment:
- **Frontend**: React Router v7 app deployed to Vercel Edge
- **Backend**: Convex functions run on Convex infrastructure
- **Assets**: Static assets served via Vercel CDN

### Docker Support:
- Development and production containers available
- Environment variable injection
- Health checks and monitoring

## Development Workflow

### Commands:
```bash
# Development
npm run dev              # Start dev server with HMR
npx convex dev          # Start Convex backend

# Production
npm run build           # Build for production
npm run start           # Start production server

# Quality
npm run typecheck       # TypeScript type checking
```

### Key Development Patterns:
1. **Loader-based data fetching** for SSR and SEO
2. **Real-time subscriptions** for live updates
3. **Parallel data fetching** to minimize waterfalls
4. **Error boundaries** for graceful error handling
5. **Webhook validation** for security

## Security Considerations

1. **Webhook Signature Validation**: All webhooks verified using standard webhook libraries
2. **Authentication Context**: Convex auth context validates user identity
3. **Environment Secrets**: Sensitive data stored in environment variables
4. **CORS Configuration**: Proper CORS headers for API endpoints
5. **Route Protection**: Loader-based authentication checks

## Scalability Features

1. **Serverless Functions**: Convex functions scale automatically
2. **Real-time Database**: Built-in real-time capabilities
3. **CDN Integration**: Vercel CDN for static assets
4. **Parallel Processing**: Concurrent data fetching patterns
5. **Caching**: Built-in caching for database queries

This architecture provides a solid foundation for building scalable SaaS applications with modern development practices and real-time capabilities.