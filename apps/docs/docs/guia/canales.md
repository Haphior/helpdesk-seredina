# Canales de entrada

Todo lo que llega a Seredina termina siendo un ticket, sin importar por
dónde entró — esa convergencia es literalmente lo que significa el nombre
del producto. Esta página cubre cómo configurar cada canal de entrada;
para notificaciones *salientes* (Slack, Teams, tu propio webhook), ver
[Webhooks salientes](/api/webhooks).

## Correo electrónico

**Administración → Canales de Correo** — cada canal necesita credenciales
IMAP (para leer) y SMTP (para responder), más un nombre y la dirección
"de" que ven los contactos. Las contraseñas se cifran en reposo con
`ENCRYPTION_KEY` (AES-256-GCM) — nunca se guardan en texto plano.

El worker revisa cada buzón activo por polling (cada `EMAIL_POLL_INTERVAL_MS`,
30 segundos por defecto) — no es una suscripción push. Un correo nuevo de
un remitente desconocido crea un ticket; una respuesta a un hilo existente
se agrega como mensaje al ticket correspondiente.

## API

Para integraciones propias — tu sitio, un script, cualquier sistema que
pueda hacer un `POST`. Ver [API REST](/api/rest-api) para el detalle
técnico completo con ejemplos.

## Widget de chat embebible

Un `<script>` que convierte cualquier página web en un canal de chat, sin
cuenta ni credencial de por medio. Ver
[Widget embebible](/api/widget).

## Telegram

**Administración → Telegram** — conectá tu propio bot (creado con
[@BotFather](https://t.me/BotFather)) pegando su token. Un mensaje directo
al bot crea un ticket; el agente responde desde la consola como cualquier
otro canal, y la respuesta llega al usuario por Telegram.

::: warning Requiere una URL pública real
Telegram entrega mensajes llamando directamente a tu API — necesitás
`API_PUBLIC_URL` configurada con una dirección HTTPS real y alcanzable
desde internet. `localhost` no funciona para este canal en particular. Ver
[Variables de entorno](/despliegue/variables-de-entorno#red-y-puertos).
:::

## Alertas de monitoreo (NOC/SOC)

**Administración → Integraciones de Monitoreo** trae instrucciones
listas para copiar y pegar para conectar:

- **Grafana Alerting** — un "contact point" tipo webhook apuntando a
  `/v1/alerts/grafana`, que acepta el payload nativo de Grafana sin
  transformación.
- **Zabbix** — un script de acción/notificación que llama al endpoint
  genérico `/v1/alerts`.

Ambos convierten una alerta que dispara en un ticket, con la severidad de
la alerta mapeada a una prioridad de ticket. Es el mismo mecanismo
genérico documentado en [API REST](/api/rest-api#post-v1-alerts) — no hace
falta una integración de backend específica por cada herramienta de
monitoreo nueva, cualquiera que pueda mandar un `POST` con un token
Bearer sirve.
