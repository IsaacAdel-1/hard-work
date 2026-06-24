# 🚀 Work Hard

A modern productivity web app combining a **To-Do board** and a **Pomodoro study timer**.

## Features

- **Tasks board** — add colored tasks, mark them done (they move to a "Completed" column), undo, or delete.
- **Pomodoro timer** — Focus / Break modes with a custom, savable duration, a progress ring, a sound + notification when time is up, and a daily session counter.
- **Profile** — completion stats and a history of completed tasks grouped by day, with search and date filters.
- Data is saved per browser (guest mode). A full account system (JWT + bcrypt, MongoDB) is built in and ready to enable later.

## Tech stack

- **Frontend:** vanilla HTML / CSS / JS (`public/`)
- **Backend:** Node.js + Express (`server.js`)
- **Database:** MongoDB (via the official driver, `db.js`)
- **Auth (currently disabled in the UI):** JWT + bcrypt

## Run locally

```bash
npm install
cp .env.example .env      # then edit .env with your values
npm start
```

Open <http://localhost:4000> (or whatever `PORT` you set).

## Environment variables

See [`.env.example`](.env.example). `.env` is git-ignored and must **never** be committed.

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | for the account API | MongoDB Atlas connection string |
| `MONGODB_DB` | no | Database name (default `workhard`) |
| `JWT_SECRET` | in production | Long random string for signing tokens |
| `PORT` | no | Port to listen on (hosts set this automatically) |

## Deploy

The app serves its static frontend and API from a single Node process, so it runs on any
Node host (Render, Railway, Fly.io, a VPS, etc.).

1. Push the repo to GitHub (`.env` stays ignored).
2. Create a Node web service on your host with:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
3. Set the environment variables above in the host's dashboard.
4. In MongoDB Atlas → **Network Access**, allow your host's IP (or `0.0.0.0/0`).

> The frontend works in guest mode without a database. MongoDB is only needed for the
> account API, which is currently disabled in the UI.
