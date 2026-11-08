# SmartQueue

SmartQueue combines accessible indoor wayfinding with digital queue tickets for public services. Visitors can choose an accessibility profile, join a service queue, follow ticket updates, and view a route to the assigned desk.

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

## Accessibility notes

The indoor map is a schematic view of the building graph. Route instructions are also available as text and can be read aloud. The current building data is a demo; replace it with a verified floor plan and measured routes before using the system in a real institution.
