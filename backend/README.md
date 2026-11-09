## CS Submit Form Wrapper

### Overview

This repository serves an api. This API uses configurable JWT secret, issuer and audience to handle user verification.
Inside that JWT it has a configurable field called ROLE_FIELD which it uses to verify the user permissions. Given those permissions it will pass off calls to the Form.io proxy using admin credentials configured via PLUGIN_FORMIO_V5_ADMIN_USERNAME and PLUGIN_FORMIO_V5_ADMIN_PASSWORD.

### Language

The Api is written in typescipt and uses the express library for routing and the passport js library for authentication

### Node Version

This repository is built with node 24 and is set up inside the .nvmrc

### Environment

The backend uses two env files, loaded in order (later overrides earlier):

1. **`.env`** — Base config (Form.io URL, JWT issuer/audience, role mapping). Created from `.env.example`.
2. **`.env.local`** — Credentials and secrets (Form.io admin, session secret). Created from `.env.local.example`.

**How they are created**

- In the devcontainer: `.env` and `.env.local` are created from their `.example` files if they don't exist. `.env.local` is never overwritten once it exists.
- Outside the devcontainer: copy the examples manually:
  ```bash
  cp .env.example .env
  cp .env.local.example .env.local
  ```

**How they are applied**

- At startup, the app loads `.env` first, then `.env.local` with `override: true`, so `.env.local` overrides any matching keys in `.env`.
- Put credentials and secrets in `.env.local` only; it is gitignored and never committed.

| File                 | Purpose                                 | Committed |
| -------------------- | --------------------------------------- | --------- |
| `.env.example`       | Base config template                    | Yes       |
| `.env.local.example` | Credentials template (Form.io, session) | Yes       |
| `.env`               | Active base config                      | No        |
| `.env.local`         | Active credentials, secrets             | No        |

### Docker

The docker file exists but is untested

### Form Wrapper

This project serves as a wrapper for formio currnetly, but it is not tied to formio, it can wrap other projects and multiple projects
