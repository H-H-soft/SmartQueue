# SmartQueue

SmartQueue combines indoor wayfinding for the AIRI @ UTCN ground floor with a visitor-support ticket queue. Visitors can choose an accessibility profile, request orientation help, track the request, and open a route only when its destination is actually present on the plan.

## Run locally on Windows

Requirements: Node.js 22.12 or newer. The app uses a local SQLite database file, so Docker and a separate database installation are not required.

```powershell
npm ci
npm run dev:all
```

On the first run, `dev:all` creates a private `.env` file with a random staff key, generates the Prisma client, creates and seeds the SQLite database, then starts the backend and frontend together. Open `http://localhost:5173`.

Stop both development servers with `Ctrl+C` in the terminal. The database stays in `prisma/smartqueue.db` between runs.

## Useful commands

- `npm run dev:all` — prepare the local database and start both servers.
- `npm run dev` — start only the frontend.
- `npm run dev:backend` — start only the backend after setup.
- `npm run build` — create a production frontend build.

The generated `.env` contains the staff API key. Keep it private and do not commit it.

### Visitor accounts

Visitors can use the app without an account, or register with an email address and a password of at least 10 characters. Accounts can sign in again on the same browser, keep accessibility preferences in SQLite, and see tickets created while signed in. Passwords are stored as scrypt hashes; browser sessions expire after 30 days. Account email is not verified yet, and password recovery is not available, so this local account flow still needs those features and a production deployment review before public release.

### Optional AI replies

The visitor assistant answers app, service, and map questions locally first. Open-ended questions can use Google's Gemini API free tier. Create an API key in [Google AI Studio](https://aistudio.google.com/app/apikey), then add it to the local `.env` file:

```env
GEMINI_API_KEY=your-private-key
GEMINI_MODEL=gemini-3.5-flash-lite
```

Restart `npm run dev:all` after saving. The key stays on the backend and is never sent to the browser. At the beginning of each app session, visitors can answer “da” or “nu” aloud or use the accessible buttons. Choosing “nu” immediately stops listening and app speech, with no spoken confirmation; the app stays quiet for the rest of that session. Voice can be enabled later from the assistant's microphone button. With voice enabled, it listens after each spoken reply. Before an open-ended question is sent, the visitor must enable AI replies or give verbal consent. The question and public SmartQueue service names are sent to Google; ticket and account details are not. The free tier may use prompts and responses to improve Google products.

Tickets are for “Ajutor pentru orientare” and “Alte întrebări despre vizită”. They enter the SmartQueue queue and can be handled from the staff view. The AIRI support point is not confirmed on the plan, so the app does not draw a route to it or claim AIRI staff have received a ticket. Restarting with `npm run dev:all` refreshes the local service catalog from `src/data/airi-support.json`.

## Accessibility notes

The indoor map is a schematic view derived from the AIRI virtual-tour scan graph. It is not a surveyed floor plan: rooms, doors, landmarks, distances, the support point, and step-free access have not been confirmed. The app does not detect the visitor's location. Do not rely on estimated routes as verified real-world accessibility guidance.
