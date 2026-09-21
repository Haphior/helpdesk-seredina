# Servidor MCP

`apps/mcp-server` expone el mismo catálogo de herramientas que usa el
copiloto de IA interno (consultar/responder/cambiar estado/asignar/aplicar
macro/escalar sobre tickets) a **tu propio** agente compatible con MCP —
Claude Desktop, un flujo de n8n, un script propio. Es la forma de conectar
un agente de IA externo a Seredina sin reimplementar nada de la lógica de
negocio ni saltarte los controles de autorización.

## Dos transportes

Elegís con `MCP_TRANSPORT` (por defecto `stdio`):

### `stdio`

Un proceso separado de `api`/`worker` — no forma parte de un
`docker compose up` normal. El cliente lo lanza por sesión y controla su
stdin/stdout directamente, igual que Claude Desktop lanza cualquier otro
servidor MCP local. El tenant se resuelve una sola vez al arrancar, a
partir de `SEREDINA_API_KEY`.

```bash
# 1. Creá una API Key desde Administración → Claves de API en la consola.

# 2. Construí la imagen:
docker build -f infra/docker/Dockerfile.mcp-server -t seredina-mcp-server .

# 3. Apuntá tu cliente MCP a:
docker run -i --rm \
  -e SEREDINA_API_KEY=<tu clave> \
  -e DATABASE_URL=... \
  -e ENCRYPTION_KEY=... \
  seredina-mcp-server
```

En desarrollo, correr `apps/mcp-server` directamente con `tsx`/`node`
(ver el script `dev` en `apps/mcp-server/package.json`) evita el paso de
build de imagen.

### `http`

Un servicio de red genuinamente siempre-activo (Streamable HTTP,
deliberadamente sin estado), para un agente remoto o de larga duración en
vez de uno lanzado localmente. Cada request lleva su propio header
`Authorization: Bearer <ApiKey>` — el tenant se resuelve en cada llamada,
nunca queda cacheado del lado del servidor.

```bash
docker compose --profile mcp up mcp-server-http
```

Gated por perfil deliberadamente — un `docker compose up` normal nunca lo
levanta. También se puede correr directo con `MCP_TRANSPORT=http` en
`apps/mcp-server`.

## Autorización

Cada llamada de herramienta que modifica datos pasa por la Política de
Autonomía del tenant (**Operaciones → Actividad del Agente de IA** en la
consola): las herramientas que no están en la lista de auto-ejecución
esperan ahí a que un humano apruebe o rechace — y **toda** llamada,
auto-ejecutada o no, queda en el mismo registro de auditoría. Tu agente
externo tiene exactamente los mismos límites que el copiloto interno, no
un camino separado con menos control.

## Catálogo de herramientas

El mismo set que el copiloto interno usa para su modo autónomo — consultar
un ticket, agregar una respuesta, cambiar estado, asignar, aplicar una
macro, escalar. Ver [Copiloto de IA](/guia/copiloto-de-ia) en la guía de
usuario para cómo funciona el lado de aprobación humana desde la consola.
