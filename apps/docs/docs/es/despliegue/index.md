# Instalación con Docker

Seredina se despliega como un conjunto de contenedores Docker. La misma
instalación sirve tanto para uso autoalojado (un solo tenant) como para
operar tu propio servicio cloud multi-tenant — el cambio es una sola
variable de entorno, no un fork ni una imagen distinta. Ver
[Modo cloud](/es/despliegue/modo-cloud) para esa diferencia.

## Requisitos

- Docker y Docker Compose (el plugin `docker compose`, no el binario viejo
  `docker-compose` v1).
- Un dominio o IP accesible si vas a exponer la instancia más allá de tu
  propia máquina — Seredina no gestiona TLS por sí sola, así que un proxy
  reverso (Caddy, nginx, Traefik) delante de `WEB_PORT`/`API_PORT` es tu
  responsabilidad. Las actualizaciones en vivo de la consola usan un stream
  de larga duración, `GET /events`, en la API: la API ya envía
  `X-Accel-Buffering: no` para nginx, pero asegúrate de que tu proxy no
  haga buffer de esa ruta ni corte conexiones inactivas en menos de ~60
  segundos (la API manda un latido cada 25). Si no logra conectarse, la
  consola vuelve a refrescar como antes.

## Instalación en tres comandos

```bash
git clone https://github.com/Haphior/helpdesk-seredina.git
cd helpdesk-seredina
./scripts/setup.sh                                # genera .env con secretos aleatorios
docker compose -f infra/docker-compose.yml up -d
```

Eso es todo. `scripts/setup.sh` genera cada secreto (`JWT_SECRET`,
`ENCRYPTION_KEY`, las contraseñas de Postgres) con `openssl rand` — nunca
valores fijos. El servicio `migrate` aplica el esquema y las políticas de
Row-Level Security y termina; después arrancan `api`, `worker` y `web`.

Abrí `http://localhost:8080` (o el puerto que hayas puesto en `WEB_PORT`) y
registrá tu organización en `/register`. No hay un paso de bootstrap por
CLI aparte — el mismo flujo de registro funciona igual en modo autoalojado
y en modo cloud.

::: tip Regenerar secretos
`scripts/setup.sh` no toca un `.env` que ya existe. Si querés secretos
nuevos desde cero, borrá `.env` primero — pero tené en cuenta que esto
invalida cualquier contraseña de canal de correo ya guardada, cifrada con
el `ENCRYPTION_KEY` anterior.
:::

## Qué levanta el `docker compose`

| Servicio | Qué hace |
|---|---|
| `postgres` | Base de datos, con Row-Level Security aislando cada tenant |
| `redis` | Cola de trabajos (BullMQ) para descubrimiento de red, envío de correo/webhooks, y timers de SLA |
| `migrate` | Aplica el esquema, crea el rol `app_tenant`, aplica las políticas RLS, y termina — no queda corriendo |
| `api` | La API Fastify — toda la lógica de negocio |
| `worker` | Procesamiento en segundo plano: descubrimiento agentless, correo entrante/saliente, webhooks, notificaciones, escalamiento de SLA |
| `web` | La consola de agentes (React) |
| `mcp-server-http` | Opcional, gated por perfil (`--profile mcp`) — servidor MCP en modo HTTP para agentes de IA externos, ver [Servidor MCP](/es/api/mcp-server) |

## Si un contenedor no arranca

`docker compose -f infra/docker-compose.yml logs api` (o `worker`) es el
primer lugar para mirar. Tanto `api` como `worker` validan **todas** las
variables de entorno requeridas al arrancar y reportan todo lo que falta o
está mal formado en un solo mensaje — no se cae en la primera variable
faltante para forzarte a un ciclo de arreglar-reiniciar-descubrir-la-
siguiente.

Ver también [Variables de entorno](/es/despliegue/variables-de-entorno) para
la referencia completa y [Solución de problemas](/es/despliegue/solucion-de-problemas)
para los casos más comunes.

## Desarrollo local (sin Docker para la app)

Si vas a modificar el código en vez de solo correr una instancia:

```bash
npm install
docker compose -f infra/docker-compose.yml up -d postgres redis
npm run dev:api

# en una segunda terminal
npm run dev --workspace=apps/web   # http://localhost:5173

# en una tercera, solo si necesitás descubrimiento/correo funcionando
npm run dev --workspace=apps/worker
```

Requiere Node.js 20+ (Fastify 5 y `@fastify/jwt` 10 lo exigen). El esquema,
las migraciones y el seed viven en `packages/db`, no en `apps/api` — correr
`npm run prisma:generate|prisma:migrate|prisma:deploy|prisma:seed
--workspace=@seredina/db`.
