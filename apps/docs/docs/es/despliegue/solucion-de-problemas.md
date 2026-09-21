# Solución de problemas

## Un contenedor no arranca

`docker compose -f infra/docker-compose.yml logs api` (o `worker`, `web`,
`migrate`) es siempre el primer lugar para mirar. `api` y `worker` validan
**todas** las variables de entorno requeridas al iniciar y reportan todo lo
que falta o está mal formado en un único mensaje — no se detienen en la
primera variable faltante y te obligan a un ciclo de arreglar-reiniciar-
descubrir-la-siguiente.

## "this self-hosted instance already has a tenant"

Estás en `SEREDINA_MODE=self_hosted` (el modo por defecto, pensado para
una sola organización) e intentaste registrar una segunda. Si de verdad
necesitás múltiples organizaciones independientes, es
[modo cloud](/es/despliegue/modo-cloud), no self-hosted.

## `ENCRYPTION_KEY` inválida

Tiene que ser exactamente 64 caracteres hexadecimales (32 bytes) —
generala con `openssl rand -hex 32`. Un valor más corto, más largo, o con
caracteres fuera de `0-9a-f` hace que `api` rechace arrancar con un
mensaje explícito señalando esta variable.

## El copiloto de IA responde 503

Es el comportamiento esperado sin un proveedor de IA configurado — no es
un error de instalación. Revisá `AI_PROVIDER` y la clave correspondiente
(`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, o que `OLLAMA_BASE_URL` apunte a
una instancia de Ollama corriendo de verdad) en
[Variables de entorno](/es/despliegue/variables-de-entorno). También revisá
que el tenant no tenga su propia clave configurada en Configuración → IA
que esté mal — si el tenant tiene una clave propia, se usa *en vez de* la
del despliegue, nunca como respaldo.

## Telegram no entrega mensajes

`API_PUBLIC_URL` tiene que ser una URL HTTPS real, alcanzable desde
internet — Telegram la llama directamente para entregar cada mensaje, así
que `localhost` o un hostname interno de Docker Compose nunca va a
funcionar. Si estás probando en local sin un dominio público, Telegram no
es viable todavía; usá un canal de correo o la API en su lugar.

## Un canal de correo dejó de sincronizar

Las contraseñas IMAP/SMTP se cifran con `ENCRYPTION_KEY` al guardarlas. Si
rotaste esa clave sin migrar los datos existentes, cada contraseña
guardada antes del cambio queda indescifrable — hay que volver a cargarla
desde Configuración → Canales de correo. Fuera de eso, revisá los logs de
`worker` (es quien hace el polling IMAP, no `api`).

## Puerto ya en uso

`API_PORT` (4000), `WEB_PORT` (8080), `POSTGRES_PORT` (5432) y
`REDIS_PORT` (6379) son los cuatro puertos expuestos al host. Si alguno
choca con otro servicio ya corriendo en tu máquina, cambialo en `.env` —
no hace falta tocar nada más, el `docker-compose.yml` los lee todos como
variables.

## `docker compose` no se reconoce

Necesitás el plugin moderno (`docker compose`, sin guion), no el binario
viejo `docker-compose` v1 (con guion) — son paquetes distintos. En
Ubuntu/Debian, `sudo apt install docker-compose-plugin` lo instala; en
Docker Desktop ya viene incluido.

## Nada de esto resuelve tu caso

Abrí un
[issue en GitHub](https://github.com/Haphior/helpdesk-seredina/issues) con
la salida de `docker compose logs` del servicio que falla y tu `.env` **sin
los valores de los secretos** (nombres de variable sí, valores no).
