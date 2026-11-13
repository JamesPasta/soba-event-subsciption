# SOBA

Soba is a web-based application designed for creating web forms and managing collected data. It is a free service available to all B.C. government employees and contractors with an IDIR account.

## Prerequisites

You need a Docker-compatible runtime:

- Colima
- Rancher Desktop
- Docker Desktop

As long as the command `docker ps` works, VS Code Dev Containers will run correctly.

---

## Quick Start (Recommended)

### 1. VS Code Dev Containers

1. Install [VS Code](https://code.visualstudio.com/) and the  
   [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
2. Open the project folder in VS Code
3. Click the green remote indicator in the bottom-left corner and select  
   **“Reopen in Container”**
4. Wait for the devcontainer to build and start
5. Start the services using VS Code launch configurations:
   - **SOBA Backend**
   - **SOBA Frontend**
   - Or the combined **SOBA (Backend + Frontend)** compound

### Service URLs

- **Backend**: http://localhost:4000
- **Frontend**: http://localhost:5173

---

## Development

### Backend

Runs on **port 4000** with hot reload:

```
npm run dev --prefix backend
```

Or use the VS Code launch configuration **SOBA Backend**.

### Frontend

Runs on **port 5173** using Vite:

```
npm run dev --prefix frontend -- --host
```

Or use the VS Code launch configuration **SOBA Frontend**.

### Start both services on Windows

From PowerShell at the repository root, run:

```powershell
.\start-soba.ps1
```

The script builds the shared library, starts the local Docker services,
initializes the database, and opens the backend and frontend development
servers in separate PowerShell windows.
It uses the SOBA PostgreSQL container on port 5432 by default. If another
service owns that port, it selects a free port in 5440–5499 and reuses the
container's port on subsequent starts (including `-SkipServices`). Set
`DATABASE_URL` or the individual `DB_*` variables to use a different database.
Because no local SSO provider
is included, it also uses placeholder development IdP values; real IDIR login
requires overriding the IdP environment variables with valid SSO settings.
The launcher configures the local Form.io sidecar at `http://localhost:3001`
with the development credentials from `.devcontainer/docker-compose.yml`, so
creating forms works when the sidecar is running.
For endpoint tokens, it generates a per-user development encryption key on the
first start and reuses the Windows-protected key in
`%LOCALAPPDATA%\SOBA\event-subscription.key`. An explicitly set
`SOBA_EVENT_SUBSCRIPTION_ENCRYPTION_KEY` takes precedence; keep that key stable
so saved tokens remain readable.
The application is available at:

- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:4000

To start only the application servers when the Docker services are already
running, use:

```powershell
.\start-soba.ps1 -SkipServices
```

When startup detects existing application processes on ports 3000, 3100, or
4000, it prompts before stopping them. The default response is **Yes**.

To stop the backend and frontend development servers:

```powershell
.\stop-soba.ps1
```

To stop the development servers and Docker backing services:

```powershell
.\stop-soba.ps1 -StopServices
```

### MongoDB (Optional)

If enabled in `.devcontainer/docker-compose.yml`, MongoDB runs as a sidecar container and is available at:

```
mongodb://mongodb:27017
```

---

## Building Docker Images

See [docs/build-images.md](docs/build-images.md) for building images, targeting platforms (amd64/arm64), and pulling for local use.

## Project Structure

- `backend/` — Express.js API server
- `frontend/` — React + Vite application
- `lib/`: shared schemas, types and Form.io schema normalization used by backend and frontend (`@soba/lib`)
- `.devcontainer/` — Devcontainer configuration
- `.vscode/` — Launch configurations for backend and frontend

---

## Troubleshooting

### Docker connection issues

Ensure your Docker runtime is running:

```
docker ps
```

### Port conflicts

If ports 4000 or 5173 are in use, update the forwarded ports in `.devcontainer/devcontainer.json`.

### Container won’t start

Check logs:

```
docker compose -f .devcontainer/docker-compose.yml logs
```

### Slow file sync

Some Docker runtimes have slower file sharing.
Check your runtime’s file sharing settings.
