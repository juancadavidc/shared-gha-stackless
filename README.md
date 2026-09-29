# shared-gha-stackless

GitHub Actions reutilizables para los proyectos Node/Next.js que se despliegan en **Coolify**
con imágenes de **GHCR**. Coolify nunca construye: CI construye, publica y le avisa a Coolify
que haga pull.

```
PR ──────────────► ci.yml       node-ci + image-smoke
merge a main ────► staging.yml  node-ci → smoke → ghcr …/web:staging + :<sha> → Coolify staging
pre-release RC ──► release.yml  node-ci → smoke → ghcr …/web:vX.Y.Z + :latest → release vX.Y.Z
                                → Coolify producción → espera → health check
```

`latest` es **solo** de producción y solo lo mueve un release. La app de staging en Coolify hace
pull de `:staging`; la de producción, de `:latest`.

## Uso

Cada proyecto tiene tres archivos cortos en `.github/workflows/`. El trigger, la concurrencia y
los permisos del token van en el consumidor (GitHub no los hereda). Apunta siempre a `@v1`.

### `ci.yml`

```yaml
name: CI

on:
  pull_request:

concurrency:
  group: ci-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  verify:
    uses: juancadavidc/shared-gha-stackless/.github/workflows/node-ci.yml@v1

  smoke:
    uses: juancadavidc/shared-gha-stackless/.github/workflows/image-smoke.yml@v1
    with:
      dockerfile: docker/Dockerfile
      health-paths: /api/health /api/health/db
      env: |
        BETTER_AUTH_SECRET=ci-secret-ci-secret-ci-secret-0000
        BETTER_AUTH_URL=http://localhost:3000
```

### `staging.yml`

```yaml
name: Staging

on:
  push:
    branches: [main]

# Un merge nuevo reemplaza al anterior: solo se publica y despliega el último.
concurrency:
  group: staging
  cancel-in-progress: true

jobs:
  staging:
    permissions:
      contents: read
      packages: write
    uses: juancadavidc/shared-gha-stackless/.github/workflows/staging.yml@v1
    with:
      dockerfile: docker/Dockerfile
      build-args: NEXT_PUBLIC_GA_ID=${{ vars.NEXT_PUBLIC_GA_ID }}
      staging-url: ${{ vars.STAGING_URL }}
    secrets: inherit
```

### `release.yml`

```yaml
name: Release a producción

on:
  release:
    types: [prereleased]
  workflow_dispatch:
    inputs:
      tag:
        description: Tag del pre-release a promover (p. ej. v1.0.0-rc.1)
        required: true

# Un release a la vez; nunca se cancela uno a medio desplegar.
concurrency:
  group: release-produccion
  cancel-in-progress: false

jobs:
  release:
    permissions:
      contents: write
      packages: write
    uses: juancadavidc/shared-gha-stackless/.github/workflows/release.yml@v1
    with:
      tag: ${{ github.event.release.tag_name || inputs.tag }}
      dockerfile: docker/Dockerfile
      build-args: NEXT_PUBLIC_GA_ID=${{ vars.NEXT_PUBLIC_GA_ID }}
      production-url: ${{ vars.PRODUCTION_URL }}
    secrets: inherit
```

Para sacar un release: publica en GitHub un **pre-release** con tag `vX.Y.Z-rc.N` sobre un commit
de main (`gh release create v1.2.0-rc.1 --prerelease --target main --generate-notes`), o lanza
`release.yml` a mano con ese tag.

## Secretos, variables y environments del consumidor

| Nombre | Tipo | Dónde | Para qué |
|--------|------|-------|----------|
| `COOLIFY_TOKEN` | secret | repo | Token de la API de Coolify |
| `COOLIFY_WEBHOOK_URL` | secret | repo | Webhook de deploy de la app de **staging** |
| `COOLIFY_PROD_WEBHOOK_URL` | secret | environment `production` | Webhook de deploy de la app de **producción** |
| `NEXT_PUBLIC_GA_ID` | variable | repo | Measurement ID de GA4 (no es secreta; se hornea en build) |
| `STAGING_URL` / `PRODUCTION_URL` | variable | repo | URL pública; en producción habilita el health check |

- Sin `COOLIFY_WEBHOOK_URL`/`COOLIFY_TOKEN`, staging publica la imagen y avisa sin fallar (repo
  recién creado, aún sin app en Coolify). En producción faltar un secreto **falla**.
- El environment `production` puede exigir aprobación manual antes del deploy
  (Settings → Environments → Required reviewers). `staging` se crea solo en el primer deploy.
- Los valores que se pasan como `with:` (`build-args`, URLs) se leen de `vars` en el consumidor:
  los valores de `vars` no se pasan solos a un workflow reutilizable.

## Catálogo

### Bloques

**`node-ci.yml`** — verificación por convención de scripts. Corre, en este orden, los que existan
en `package.json`: `lint`, `typecheck`, `brand-lint`, `check-migrations <base>`, `db:migrate`,
`test`, `build`. El gestor sale del lockfile (`pnpm-lock.yaml` o `package-lock.json`).
`check-migrations` recibe `origin/<base>` en un PR y el commit previo en un push.

| Input | Default | |
|-------|---------|--|
| `working-directory` | `.` | Carpeta del `package.json` |
| `node-version-file` | `.nvmrc` | Relativo a la raíz; si no existe se usa `node-version` |
| `node-version` | — | Gana sobre el archivo; sin ninguno, `22` |
| `postgres` | `true` | Postgres 17 efímero; exporta `DATABASE_URL=postgres://ci:ci@localhost:5432/ci` |
| `env` | — | Líneas `KEY=VAL` no secretas (pueden pisar `DATABASE_URL`) |
| `ref` | evento | Commit a verificar |
| `skip-scripts` | — | Scripts de la convención que no se corren |

**`image-smoke.yml`** — construye la imagen sin publicarla, la arranca con red del host y exige 2xx
en cada ruta. Inputs: `context` (`.`), `dockerfile` (`<context>/Dockerfile`), `build-args`, `env`,
`health-paths` (`/api/health`), `port` (`3000`), `postgres` (`true`, con el mismo `DATABASE_URL`),
`ref`.

**`docker-publish.yml`** — build + push a `ghcr.io/<owner>/<repo>/<service>` (en minúsculas) con
cada tag de `tags`. Usa el `GITHUB_TOKEN`: el job que llama necesita `packages: write`. Inputs:
`context`, `dockerfile`, `service` (`web`), `tags` (requerido), `build-args`, `ref`.
Output: `image`.

**`coolify-deploy.yml`** — POST al webhook (Coolify 4.x), espera opcional al estado final del
deployment y health check. Inputs: `environment` (`staging`; `production` usa
`COOLIFY_PROD_WEBHOOK_URL`), `environment-url`, `require-secrets` (`false`), `wait` (`false`),
`health-path` (`/api/health`), `health-expect` (texto que debe traer la respuesta). El health
check solo corre con `wait` y `environment-url`.

### Flujos

**`staging.yml`** y **`release.yml`** componen los bloques. Aceptan los inputs de `node-ci`
(`ci-env` en vez de `env`), de `image-smoke` con prefijo `smoke-` (`smoke: false` lo apaga), de la
imagen (`context`, `dockerfile`, `service`, `build-args`) y del deploy (`staging-url`;
`production-url`, `health-path`, `health-expect`). `release.yml` además requiere `tag`.

Para un monorepo con varias imágenes, llama `docker-publish` y `coolify-deploy` una vez por
servicio en vez de usar los flujos.

## Desarrollo de este repo

- `self-test.yml` corre actionlint y los bloques contra `tests/fixtures/`.
  Localmente: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7`.
- Versionado semver. Tras mergear a main:
  ```bash
  git tag v1.2.3 && git tag -f v1 && git push origin v1.2.3 && git push -f origin v1
  ```
  Un cambio incompatible en inputs o comportamiento abre `v2`; `v1` no se mueve a él.
