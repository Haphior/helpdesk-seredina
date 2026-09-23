# Variables de entorno

Referencia completa de `.env` (ver `.env.example` en el repo, que es la
fuente de verdad — esta página lo explica en prosa). `scripts/setup.sh`
genera automáticamente todas las marcadas como "secreto generado"; el
resto tiene un valor por defecto razonable o es opcional.

## Base de datos y cola

| Variable | Requerida | Descripción |
|---|---|---|
| `POSTGRES_USER` | Sí | Usuario de migración (`app_migrator` por defecto). Solo `migrate` se conecta con este rol. |
| `POSTGRES_PASSWORD` | Sí (secreto generado) | Contraseña del usuario de migración. |
| `POSTGRES_DB` | Sí | Nombre de la base de datos (`seredina` por defecto). |
| `POSTGRES_PORT` | No | Puerto expuesto por el contenedor de Postgres (`5432` por defecto). |
| `REDIS_PORT` | No | Puerto expuesto por Redis (`6379` por defecto). |
| `APP_TENANT_DB_PASSWORD` | Sí (secreto generado) | Contraseña del rol `app_tenant`, creado por `packages/db/prisma/rls/policies.sql` al migrar. **El único rol con el que `api` y `worker` se conectan** — nunca usan el rol de migración en producción. |

## Seguridad

| Variable | Requerida | Descripción |
|---|---|---|
| `JWT_SECRET` | Sí (secreto generado) | Firma los tokens de sesión. |
| `JWT_EXPIRES_IN` | No | Cuánto dura una sesión de la consola antes de tener que volver a iniciar sesión (`8h` por defecto; acepta valores como `30m`, `12h`, `1d`). Desactivar un usuario o cambiar su rol surte efecto de inmediato de todos modos. |
| `ENCRYPTION_KEY` | Sí (secreto generado) | Cifra en reposo (AES-256-GCM) las contraseñas IMAP/SMTP de los canales de correo, y otros secretos por tenant. **Debe tener exactamente 64 caracteres hexadecimales** (`openssl rand -hex 32`). |

::: warning Perder este `ENCRYPTION_KEY` es irreversible
Si lo perdés o lo rotás sin migrar los datos existentes, **toda** contraseña
de canal de correo ya guardada queda indescifrable — hacele backup con la
misma seriedad que a una contraseña de base de datos.
:::

## Modo de despliegue

| Variable | Requerida | Descripción |
|---|---|---|
| `SEREDINA_MODE` | Sí | `self_hosted` o `cloud`. Ver [Modo cloud](/es/despliegue/modo-cloud) para qué cambia realmente. |

## Copiloto de IA (opcional)

Sin configurar, el copiloto de IA responde con un 503 claro en vez de que
la API se niegue a arrancar — es una funcionalidad opcional, no un
requisito de instalación.

| Variable | Requerida | Descripción |
|---|---|---|
| `AI_PROVIDER` | No | `anthropic`, `openai`, u `ollama`. Sin definir, usa `anthropic` si `ANTHROPIC_API_KEY` está seteada (compatibilidad hacia atrás). |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | No | Clave de [console.anthropic.com](https://console.anthropic.com/). `ANTHROPIC_MODEL` sobreescribe el modelo por defecto. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | No | Clave de [platform.openai.com](https://platform.openai.com/). |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | No | Sin costo por llamada, corre contra una instalación local de [Ollama](https://ollama.com). `OLLAMA_BASE_URL` por defecto `http://localhost:11434/v1`. |

Además de esta configuración a nivel de despliegue, cada tenant puede traer
su propia clave (BYOK) desde Configuración → IA en la consola — si la
tiene, se usa *exclusivamente*, nunca como respaldo la configuración global
del despliegue.

## Red y puertos

| Variable | Requerida | Descripción |
|---|---|---|
| `API_PORT` | No | Puerto de la API (`4000` por defecto). |
| `WEB_PORT` | No | Puerto de la consola web (`8080` por defecto). |
| `WEB_ORIGIN` | Sí | Debe ser como el navegador llega a la consola (nunca el hostname interno de compose). También la usa `api` para construir enlaces públicos propios (por ejemplo, un link de encuesta CSAT) — sin definir, esa funcionalidad puntual simplemente no hace nada. También es adonde Microsoft 365 / Gmail devuelven el navegador al conectar un canal de correo (`<WEB_ORIGIN>/api/email-channels/oauth/callback`, salvo que `API_PUBLIC_URL` esté definida). |
| `VITE_API_URL` | No | Déjala vacía: la consola llega a la API en `/api` de su propia dirección. Defínela solo para apuntar la consola a una API en otro origen (queda fija al compilar). |
| `API_PUBLIC_URL` | Solo si usás Telegram | URL HTTPS real, accesible desde internet, de tu API — Telegram la llama directamente para entregar mensajes, así que nunca puede ser `localhost` ni un hostname interno de compose. También es la dirección que la página Dispositivos pone en los comandos de enrolamiento de agentes. `configure-address.sh` la define como `https://<dirección>/api`. |
| `SEREDINA_SITE` | Con el perfil `proxy` | La dirección que sirve el proxy HTTPS: un dominio o IP (`http://…` si `TLS_MODE=off`). La define `scripts/configure-address.sh`. |
| `TLS_MODE` | Con el perfil `proxy` | `acme` (Let's Encrypt), `custom` (`certs/cert.pem` + `certs/key.pem`), `internal` (CA generada) u `off`. |
| `ACME_EMAIL` | Con `TLS_MODE=acme` | Recibe avisos de vencimiento si la renovación llegara a fallar. |
| `HTTP_PORT` / `HTTPS_PORT` | No | Puertos del proxy (`80` / `443`). |
| `TLS_CA_FILE` | No | Certificado de CA que fijan los agentes, para un certificado que no es de confianza pública. El script la define en `internal` y `custom`; la página Dispositivos la incluye en el comando de enrolamiento. Un archivo que contenga una clave privada se rechaza. |
| `WEB_BIND` / `API_BIND` | No | En qué interfaz escuchan los puertos de la web y la API (`0.0.0.0`). El script pone `127.0.0.1` cuando el proxy está delante, para que desde la red solo se entre por HTTPS. |
| `DB_BIND` | No | Postgres y Redis escuchan solo en `127.0.0.1`. Redis no tiene contraseña: no lo expongas. |
| `TRUST_PROXY` | No | Qué saltos pueden fijar `X-Forwarded-For`, para que los límites por IP vean al cliente real detrás de los proxies. Compose usa `loopback,uniquelocal`. |
| `COMPOSE_PROFILES` | No | `proxy` arranca el proxy HTTPS; agrega `mcp` para el servidor MCP. |

## Otras opcionales

| Variable | Requerida | Descripción |
|---|---|---|
| `SENTRY_DSN` | No | Seguimiento de errores (`api`/`worker`/`web`). Sin definir, no hace nada — apunta a Sentry.io o a una instancia propia de [GlitchTip](https://glitchtip.com/) (compatible con el protocolo de Sentry). |
| `EMAIL_POLL_INTERVAL_MS` | No | Cada cuánto el worker revisa el buzón IMAP de cada canal de correo activo (`30000` ms por defecto). |
| `MCP_HTTP_PORT` | No | Solo usada por el servicio `mcp-server-http`, gated por perfil (`docker compose --profile mcp up`). Ver [Servidor MCP](/es/api/mcp-server). |

## Validación al arrancar

`api` y `worker` validan **todas** las variables requeridas al iniciar y
reportan todo lo que falta o está mal formado en un solo mensaje —
no se detienen en la primera variable faltante. Si un contenedor no arranca,
`docker compose logs api` (o `worker`) es siempre el primer lugar donde
mirar.
