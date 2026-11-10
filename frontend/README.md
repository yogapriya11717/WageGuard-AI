# WageGuard AI — Frontend

A React + Vite prototype for freelancers to turn client conversations into project agreements, track deliverables and milestones, review scope changes, and monitor simulated milestone payments.

## Requirements
- Node.js 20.19+ or 22.12+ (Vite 8 requirement)
- npm

## Setup
```bash
npm install
npm run dev
```
Open the local URL printed by Vite.

## Production build
```bash
npm run build
npm run preview
```

## Features
- Dashboard with portfolio, collection, active-work and deadline summaries
- Project search, status filters and sorting
- Three-step project brief, local heuristic conversation analysis, editable agreement details, milestone allocation validation and approval preview
- Project details with agreement snapshot, deliverables, milestone work states, progress, scope checks and activity history
- Scope request review with accept, reject and clarification states
- Payment transaction summaries and filters
- Light/dark theme and responsive layouts
- Project data persistence in browser `localStorage` (`wageguard-projects-v1`)

## Demo / simulation boundaries
- Conversation analysis uses deterministic local text rules. It is **not** an AI model, legal review, or Gemini integration.
- Scope-change detection uses keyword/rule heuristics. Treat results as prompts for human review, not definitive contract interpretation.
- Payment actions are local simulations. No PayPal account, payment gateway, escrow, or real funds are involved.
- Data is stored in the current browser profile only. Clearing site storage or using another browser/device will not sync it. Export/backup is not currently built in.
- The app does not provide legal advice and cannot enforce an agreement or collect payment.

## Project structure
```text
src/
  components/    Shared layout, cards and UI primitives
  pages/         Dashboard, projects, project creation, details, scope and payments
  data.js        Demo data and local analysis helpers
  store.jsx      Reducer and localStorage persistence
  App.jsx        Client-side routes
```

## Useful scripts
- `npm run dev` — development server
- `npm run build` — production build
- `npm run preview` — preview the production build
- `npm run lint` — Oxlint checks

## Data reset
To reset the demo data, open browser developer tools and remove the `wageguard-projects-v1` key from Local Storage for the app's origin, then reload.
