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
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
