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

Empezá por **Canales de correo**: ahí se ve el último error de inicio de
sesión de cada buzón.

- **"Requiere reconexión"** en un canal de Microsoft 365 o Gmail: el
  proveedor revocó el acceso (cambió la contraseña del buzón, un admin
  quitó la aplicación o venció el consentimiento). El canal deja de
  revisarse hasta que hacés clic en **reconectar** e iniciás sesión otra
  vez como el buzón. No se pierde nada: el correo no leído se toma al
  reconectar.
- **Microsoft o Google dicen que la URI de redirección no coincide**: la
  URI registrada en tu aplicación tiene que ser exactamente
  `<WEB_ORIGIN>/api/email-channels/oauth/callback` (o
  `<API_PUBLIC_URL>/email-channels/oauth/callback` si esa está definida).
  Ver [Conectar Microsoft 365 o Gmail](/es/guia/canales#conectar-microsoft-365-o-gmail).
- **Buzones con contraseña después de cambiar `ENCRYPTION_KEY`**: todo
  secreto guardado con la clave anterior queda ilegible. Volvé a cargar la
  contraseña (o reconectá un canal OAuth) desde Canales de correo.

Fuera de eso, revisá los logs de `worker`: es quien revisa los buzones, no
`api`.

## Alguien perdió su app autenticadora

Puede entrar con uno de sus **códigos de recuperación** en lugar del
código de 6 dígitos. Cada uno sirve una sola vez.

Si ya no le quedan códigos, otro administrador le restablece la
verificación en dos pasos desde **Administración → Usuarios** (restablecer 2FA). La vuelve a
configurar en su próximo inicio de sesión si el espacio de trabajo la
exige.

Si la persona bloqueada es la **única administradora**, nadie puede
restablecerla desde la consola. Hacelo directamente en la base de datos
(cambiá el slug y el correo):

```bash
docker compose -f infra/docker-compose.yml exec postgres psql -U app_migrator seredina -c "
  UPDATE users SET mfa_secret_encrypted = NULL, mfa_pending_secret_encrypted = NULL,
    mfa_enabled_at = NULL, mfa_last_used_step = NULL, mfa_recovery_code_hashes = '{}',
    failed_login_attempts = 0, locked_until = NULL
  WHERE email = 'admin@ejemplo.com'
    AND tenant_id = (SELECT id FROM tenants WHERE slug = 'tu-organizacion');"
```

Un cambio hecho así no queda en el registro de auditoría. Después creá un
segundo administrador para no tener que volver a hacerlo.

## El inicio de sesión único no funciona

- **El proveedor muestra un error antes de volver**: la URI de redirección
  registrada en el proveedor tiene que coincidir exactamente con la que
  muestra **Administración → Inicio de sesión único**.
- **"Accounts from example.com can't sign in to this workspace"** (los
  errores del SSO llegan en inglés): ese dominio no está en la lista de
  dominios permitidos. Agregalo o vaciá la lista.
- **"There's no account for … in this workspace"**: la creación automática
  de cuentas está apagada. Creá el usuario antes, o activala y elegí el rol
  que reciben los usuarios nuevos.
- **Bloqueado por "exigir SSO"** mientras el proveedor está caído: los
  administradores siempre pueden entrar con su contraseña. Desactivá
  "exigir SSO" hasta que el proveedor vuelva.

## No llegan los correos de acceso al portal de clientes

El portal envía sus enlaces de acceso a través de tus canales de correo,
así que al menos uno tiene que estar **conectado** (revisá los errores en
Canales de correo). Cada dirección recibe como máximo 3 enlaces por hora,
y la página responde lo mismo conozca o no la dirección, así que un error
de tipeo parece un éxito. Un envío que falla queda en los logs de
`worker`. Los
enlaces apuntan a `WEB_ORIGIN`, que tiene que ser la dirección a la que
llegan los clientes.

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
