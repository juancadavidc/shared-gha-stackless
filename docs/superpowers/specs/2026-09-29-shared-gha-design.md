# shared-gha-stackless — diseño

Fecha: 2026-09-29 · Estado: aprobado

## Objetivo

Un repo público, `juancadavidc/shared-gha-stackless`, con los GitHub Actions comunes de los
proyectos de `~/dev/personal/opensource`, para que cada proyecto deje de copiar YAML. Los
consumidores lo llaman con `uses: juancadavidc/shared-gha-stackless/.github/workflows/<x>.yml@v1`.

La arquitectura de referencia es `starter-next-auth` (plantilla de `/new-starter-next-auth`):
nace consumiendo este repo. `griferia-baru` se migra para validar el diseño con un proyecto real.

## Decisiones

| Tema | Decisión |
|------|----------|
| Modelo de despliegue | El de griferia: merge a main → `:staging` + `:<sha>` → deploy a staging. Pre-release `vX.Y.Z-rc.N` → CI sobre ese commit → `:vX.Y.Z` + `:latest` → release final → deploy a producción, espera y health check. `latest` solo lo mueve el release. |
| CI de verificación | `node-ci` guiado por convención de scripts: corre en orden los que existan en `package.json` (`lint`, `typecheck`, `brand-lint`, `check-migrations <base>`, `db:migrate`, `test`, `build`). Gestor detectado por lockfile. |
| Mecanismo | Workflows reutilizables (`workflow_call`). Trigger, concurrencia y permisos del token quedan en el consumidor (GitHub no los hereda). |
| Visibilidad | Público: la plantilla es open source y cualquier repo generado desde ella debe tener CI funcional. No hay secretos en el repo. |
| Versionado | Tags semver `vX.Y.Z` + tag móvil `vN`. Los consumidores apuntan a `@v1`. |

## Catálogo

Bloques:

- **`node-ci.yml`** — verificación. Inputs: `working-directory` (`.`), `node-version-file`
  (`.nvmrc`), `node-version` (fallback `22` si no hay archivo), `postgres` (`true`), `env`
  (líneas `KEY=VAL` no secretas), `ref`, `skip-scripts`. Con Postgres exporta
  `DATABASE_URL=postgres://ci:ci@localhost:5432/ci` (las líneas de `env` pueden pisarlo).
- **`image-smoke.yml`** — construye la imagen sin publicarla, la arranca con red del host y
  exige que las rutas de `health-paths` respondan 2xx. Inputs: `context`, `dockerfile`, `env`,
  `health-paths`, `port`, `postgres`, `ref`.
- **`docker-publish.yml`** — build + push a `ghcr.io/<owner>/<repo>/<service>` (en minúsculas) con
  los sufijos de `tags`. Solo usa `GITHUB_TOKEN`. Inputs: `context`, `dockerfile`, `service`,
  `tags`, `build-args`, `ref`. Output: `image`.
- **`coolify-deploy.yml`** — POST al webhook de Coolify (4.x lo registra como POST), espera
  opcional al estado final del deployment y health check opcional. Inputs: `environment`
  (`staging`/`production`), `environment-url`, `require-secrets`, `wait`, `health-path`,
  `health-expect`. Secretos por `secrets: inherit`: `COOLIFY_TOKEN` y `COOLIFY_WEBHOOK_URL`
  (staging) o `COOLIFY_PROD_WEBHOOK_URL` (producción, como secret del environment `production`).
  Sin secretos: en staging avisa y no falla; con `require-secrets` falla.

Flujos (componen los bloques con `./.github/workflows/...`, que en un workflow reutilizable
resuelve al mismo repo y commit donde aparece la referencia):

- **`staging.yml`** — `node-ci` → `image-smoke` (si `smoke`) → `docker-publish` (`staging`, `<sha>`)
  → `coolify-deploy` (staging).
- **`release.yml`** — valida el tag RC → `node-ci` y `image-smoke` sobre el commit del RC →
  `docker-publish` (`vX.Y.Z`, `latest`) → `gh release create vX.Y.Z` → `coolify-deploy`
  (production, `require-secrets`, `wait`, health check).

Valores que vienen de `vars` (GA, URL de producción) se pasan como inputs desde el consumidor.

## Consumidores

Cada proyecto tiene tres archivos cortos:

| Archivo | Trigger + concurrencia | Llama a |
|---------|------------------------|---------|
| `ci.yml` | `pull_request`; cancela la corrida vieja | `node-ci` + `image-smoke` |
| `staging.yml` | `push` a main; cancela la anterior | `staging` |
| `release.yml` | `release: prereleased` + `workflow_dispatch(tag)`; nunca cancela | `release` |

- **starter-next-auth**: guarda `!github.event.repository.is_template` en staging y release;
  bloques `<optional:analytics>` alrededor del build-arg de GA; `setup.test.ts` valida los
  archivos nuevos; docs y skill explican dos apps en Coolify (staging `:staging`, producción
  `:latest`) y cómo sacar un release. Cambio de comportamiento: main ya no despliega producción.
- **griferia-baru**: `working-directory: frontend`, `context: ./frontend`, `node-version: 22`,
  `health-expect: '"estado":"ok"'`. Cambio de comportamiento: staging pasa por CI antes de publicar.
- **plugin coolify-devops**: `git-ci` y `/ci-setup` generan las tres llamadas; `/coolify-deploy` y
  `coolify-admin` crean dos apps (staging y producción). Los demás proyectos migran cuando pasen
  por `/ci-setup`.

## Pruebas

- Repo común: `self-test.yml` corre actionlint y ejecuta `node-ci` e `image-smoke` contra
  fixtures (`npm-subdir` con Postgres, `pnpm-root` sin Postgres). Verde antes de publicar `v1`.
- starter: `pnpm test` local + PR real con CI verde.
- griferia: PR real con CI verde; el merge despliega staging. El release a producción lo dispara
  el dueño con un RC.
