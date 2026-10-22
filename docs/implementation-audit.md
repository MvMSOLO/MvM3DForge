# MvM3DForge Engineering Implementation Audit Report

**Date:** 2026-10-22
**HEAD Commit:** `c63b197173d038ffeaff0641332c40db23cb46bd` (Merge PR #1)
**Branch:** `jules/real-mcp-studio-recovery`

---

## 1. Executive Summary

This audit assesses the state of MvM3DForge following the merge of PR #1. While PR #1 added several UI components and SDK modules, multiple core features were either mock implementations, disconnected from live scene rendering, or omitted from automated testing and deployment configurations.

This document details the observed behavior, underlying causes, and selected repair actions for each subsystem.

---

## 2. Detailed Audit Findings & Planned Repairs

### 2.1 In-App Fake AI Prompt-to-Model Generator (`src/components/AIPanel.tsx`)
- **Observed Behavior:** The AI panel allowed users to select providers (OpenAI, Anthropic, Gemini, Grok) and input API keys, but generating a model executed a hardcoded mock function that inserted a static cube code snippet. No network request was made to any AI provider.
- **Root Cause:** A superficial UI was built to mimic AI generation without connecting to any model backend. Furthermore, in-app AI prompt generation is undesirable for MvM3DForge, as AI reasoning is intended to be external.
- **Repair Plan:** Completely remove `AIPanel.tsx`, provider selection state, fake key inputs, and mock generator scripts. The interoperability surface for AI will exclusively be the remote `/mcp` server.

### 2.2 Remote MCP Endpoint (`/mcp` & `src/forge/ai-mcp.ts`)
- **Observed Behavior:** The existing Studio UI showed a static green "MCP Connected" badge pointing to `http://localhost:3001/mcp`. No HTTP route existed at `/mcp`, and `ai-mcp.ts` contained only basic mock functions with local checkboxes.
- **Root Cause:** Lack of a real MCP server implementation using the standard protocol and HTTP Streamable transport.
- **Repair Plan:** Build a standards-compliant remote MCP server at `/mcp` using `@modelcontextprotocol/sdk`. Implement Streamable HTTP (SSE/POST stream) routing integrated into the TanStack Start / Nitro server layer. Support standard initialization, tool listing, tool invocation (`project:read`, `scene:write`, `assets:export`), and structured JSON-RPC responses.

### 2.3 Authentication, Permissions, and Project Ownership
- **Observed Behavior:** No authorization or ownership checks protected project data or MCP endpoints. Permission toggles in the UI were local React state.
- **Root Cause:** Missing authentication middleware and token validation for external API/MCP callers.
- **Repair Plan:** Implement Bearer token / API token validation for `/mcp` requests. Associate requests with the authenticated `user_id` and enforce project ownership and granular scopes (`project:read`, `scene:write`, `assets:export`). Deny unauthorized cross-tenant requests.

### 2.4 Project State Synchronization & Source of Truth (`src/forge/store.ts` vs Studio)
- **Observed Behavior:** Studio maintained local React state for scene objects alongside a disconnected Zustand store introduced in PR #1. Inspector property changes updated store values without reliably updating the live Three.js viewport scene or vice versa. Undo/redo history was present in store functions but detached from actual viewport mutations.
- **Root Cause:** Dual state management without a central source of truth or command pattern for viewport synchronization.
- **Repair Plan:** Collapse project state into a single canonical Zustand store (`src/forge/store.ts`). Ensure all UI components (Viewport, Scene Explorer, Property Inspector, Command Palette, History Manager) read from and dispatch through this canonical store, updating both the rendered Three.js scene graph and backend persistence.

### 2.5 Cloud Project Persistence (Postgres & Database)
- **Observed Behavior:** Projects were held primarily in client browser memory or saved as local JSON file downloads. No persistent server-side project database synchronized between Studio and `/mcp`.
- **Root Cause:** Absence of database persistence layer for 3D project models.
- **Repair Plan:** Implement database tables for projects (with schema version, owner ID, scene JSON payload, and revision timestamps). Connect Studio save/load endpoints and remote `/mcp` mutations to this database with optimistic concurrency/revision checks.

### 2.6 Vercel Deployment Failure (`vercel.json`)
- **Observed Behavior:** `vercel.json` specified `"installCommand": "npm install --omit=dev --no-audit --no-fund"`.
- **Root Cause:** Build tools such as Vite, TypeScript, and Tailwind are listed in `devDependencies`. Omitting `devDependencies` during installation caused build failures on Vercel deployments.
- **Repair Plan:** Remove the `--omit=dev` flag from `vercel.json` (or use `npm ci`), ensuring all build dependencies are installed during deployment.

### 2.7 Automated Test Suite (`package.json`)
- **Observed Behavior:** PR #1 added `src/forge/ai-mcp.test.ts` and `src/forge/export-glb.test.ts`, but `npm test` did not include these test files in its execution pattern.
- **Root Cause:** Incomplete test runner glob script in `package.json`.
- **Repair Plan:** Update `package.json` test script to include `src/forge/**/*.test.ts` and ensure all unit, integration, and MCP protocol tests run and pass cleanly.

---

## 3. Next Steps

Execution will proceed sequentially through Tasks 2 through 13 as outlined in the master plan.
