# Instalación con Docker

Seredina se despliega como un conjunto de contenedores Docker. La misma
instalación sirve tanto para uso autoalojado (un solo tenant) como para
operar tu propio servicio cloud multi-tenant — el cambio es una sola
variable de entorno, no un fork ni una imagen distinta. Ver
[Modo cloud](/es/despliegue/modo-cloud) para esa diferencia.

## Requisitos

- Docker y Docker Compose (el plugin `docker compose`, no el binario viejo
  `docker-compose` v1).
- Un dominio o IP alcanzable si vas a exponer la instancia más allá de tu
  propia máquina. Seredina puede servirla con HTTPS por sí misma — ver
  [Tu dirección y HTTPS](#tu-direccion-y-https) — o puedes mantener tu
  propio proxy inverso (nginx, Traefik, …) delante de `WEB_PORT`. Si usas el
  tuyo, ten en cuenta que las actualizaciones en vivo de la consola usan un
  stream de larga duración, `GET /api/events`: no debe hacer buffer de esa
  ruta ni cortar conexiones inactivas en menos de ~60 segundos (la API
  manda un latido cada 25). Si no logra conectarse, la consola vuelve a
  refrescar como antes.

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

## Tu dirección y HTTPS

De fábrica Seredina responde en `http://localhost:8080`. Para servirla en tu
propio dominio o IP, con HTTPS, ejecuta:

```bash
./scripts/configure-address.sh
docker compose -f infra/docker-compose.yml up -d --build
```

El script pregunta la dirección (un dominio como `helpdesk.ejemplo.cl`, o la
IP del servidor) y cómo obtener el certificado:

| Modo | Úsalo cuando | Qué necesitas |
|---|---|---|
| `acme` | El servidor es accesible desde internet | Un dominio apuntando al servidor y los puertos 80 y 443 abiertos. Let's Encrypt emite y renueva el certificado solo. |
| `custom` | Tienes un certificado de la CA de tu empresa o de un proveedor | Los archivos del certificado (cadena completa) y de la clave. El script verifica que la clave corresponda, que el certificado cubra tu dirección y que lo haya firmado la CA que le indiques. |
| `internal` | Una red interna, o una dirección IP | Nada: se genera una CA privada en el primer arranque. |
| `off` | Un laboratorio, o el TLS ya termina delante de este servidor | Nada. Las contraseñas viajan sin cifrar. |

También funciona sin preguntas, por ejemplo
`./scripts/configure-address.sh --address 192.168.1.20 --tls internal`
(`--help` muestra todas las opciones), y puedes volver a ejecutarlo cuando
quieras para cambiar la dirección o el modo.

Qué cambia:

- Arranca el servicio `proxy` (Caddy) en los puertos 80 y 443. Lo que llegue
  por HTTP se redirige a HTTPS.
- La consola y la API comparten la misma dirección: la API queda en
  `https://<dirección>/api`. Esa es también la dirección que usan desde ahora
  los agentes, el widget embebible y las integraciones de monitoreo.
- Los puertos de la web (8080) y de la API (4000) pasan a escuchar solo en el
  propio servidor, así que desde la red solo se entra por HTTPS. Usa
  `--keep-direct-ports` para dejarlos abiertos mientras migras.

**Agentes.** La página Dispositivos pone la dirección correcta en cada
comando de enrolamiento. Con `custom` (CA de empresa o autofirmado) o
`internal`, el comando incluye además la huella de la CA: el agente la
descarga, la compara con esa huella y desde ahí confía solo en esa CA. No
hay que copiar nada al equipo. Un agente enrolado con la dirección antigua
`http://<ip>:4000` necesita el comando nuevo; al reenrolarlo conserva su
registro.

**Navegadores con `internal`.** Los navegadores muestran una advertencia
hasta que confíen en la CA generada. Expórtala e instálala en los equipos de
tu equipo (o por directiva de grupo):

```bash
docker compose -f infra/docker-compose.yml cp proxy:/data/caddy/pki/authorities/local/root.crt ./seredina-root-ca.crt
```

Los certificados y la CA interna viven en el volumen `caddy_data`: respáldalo
junto con lo demás, o habrá que reenrolar los agentes con una CA nueva.

## Qué levanta el `docker compose`

| Servicio | Qué hace |
|---|---|
| `postgres` | Base de datos, con Row-Level Security aislando cada tenant |
| `redis` | Cola de trabajos (BullMQ) para descubrimiento de red, envío de correo/webhooks, y timers de SLA |
| `migrate` | Aplica el esquema, crea el rol `app_tenant`, aplica las políticas RLS, y termina — no queda corriendo |
| `api` | La API Fastify — toda la lógica de negocio |
| `worker` | Procesamiento en segundo plano: descubrimiento agentless, correo entrante/saliente, webhooks, notificaciones, escalamiento de SLA |
| `web` | La consola de agentes (React), y la API bajo `/api` en la misma dirección |
| `proxy` | Opcional (`COMPOSE_PROFILES=proxy`, lo configura `configure-address.sh`) — HTTPS delante de todo, ver [arriba](#tu-direccion-y-https) |
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
