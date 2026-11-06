# SmartQueue

Application source is in `src/`:

- `src/queue/`: JavaScript queue backend and REST/Socket.IO server.
- `src/types/index.ts`: shared application and queue API types.
- `src/routing/` and `src/data/`: indoor routing and building data.
- `src/App.tsx`: frontend screen.

## Setup

Use Node.js 22.12+ and PostgreSQL. Run from this project folder:

```sh
npm ci
```

Copy `.env.example` to `.env`. Set `DATABASE_URL` and replace `STAFF_API_KEY`
with a random secret of at least 32 characters. Keep this key private.

For the supplied local PostgreSQL database, use Docker:

```sh
docker compose up -d --wait
npm run db:generate
npm run db:migrate
npm run db:seed
```

The seed uses the existing `src/data/building.json`. Database schema and migrations
are in `prisma/`.

## Run

Start the backend:

```sh
npm run dev:backend
```

In a second terminal, start the frontend:

```sh
npm run dev
```

The backend runs on port 3001. Vite forwards `/api` and `/socket.io` to it.

The API provides `/api/services`, `/api/tickets`, `/api/queues/:id`, and `/api/desks`.
Creating a ticket returns its private `accessToken`; use it as a Bearer token for
lookup and cancellation. Staff commands use `STAFF_API_KEY` as the Bearer token.
`POST /api/desks/:id/call-next` accepts `{ "serviceId": "s1" }`.

Ticket destinations use `desk.locationId`, which matches a node in the building
map. API statuses are WAITING, CALLED, SERVING, COMPLETED, CANCELLED and MISSED.
