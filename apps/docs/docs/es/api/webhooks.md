# Webhooks salientes

La dirección contraria a la API REST: en vez de que vos llames a
Seredina, Seredina te avisa a vos cuando algo pasa. Se configuran desde
**Operaciones → Webhooks** en la consola.

## Tipos de webhook

Hay tres tipos (`kind`), y el tipo se fija al crear el webhook — no se
puede cambiar después (borrar y crear uno nuevo es el mismo trabajo de
todas formas):

| Tipo | Para qué | Firma |
|---|---|---|
| `generic` | Tu propio receptor — un endpoint que vos escribiste | Sí, HMAC-SHA256 |
| `slack` | Publica directo a un canal de Slack, vía sus "Incoming Webhooks" | No |
| `teams` | Publica directo a un canal de Teams, vía la app "Workflows" | No |

Los webhooks de Slack/Teams son deliberadamente **"trae tu propia URL"**:
vos generás el webhook en tu propio workspace (Slack: Incoming Webhooks;
Teams: la plantilla "Post to a channel when a webhook request is
received" de la app Workflows) y pegás esa URL en Seredina — no hay una
app de Slack/Teams que Seredina opere ni un proceso de aprobación de
terceros de por medio.

## Eventos disponibles

Un webhook `generic` puede suscribirse a cualquier combinación de estos
cinco:

- `ticket.created`
- `ticket.updated`
- `message.created`
- `sla.first_response_breached`
- `sla.resolution_breached`

Los webhooks `slack`/`teams` están limitados a un subconjunto de tres —
`ticket.created`, `sla.first_response_breached`,
`sla.resolution_breached` — porque `ticket.updated` viaja con ids en vez
de texto legible, y `message.created` podría filtrar una nota interna o el
mensaje de un cliente a un canal potencialmente público sin que lo hayas
elegido explícitamente.

## Firma (solo webhooks `generic`)

Cada entrega a un webhook `generic` incluye el header
`X-Seredina-Signature: sha256=<hmac>`, calculado con el secreto que
Seredina generó al crear el webhook (se muestra una sola vez, igual que
una API Key):

```js
const crypto = require('crypto');

function verificarFirma(bodyCrudo, firmaHeader, secreto) {
  const esperada = 'sha256=' + crypto.createHmac('sha256', secreto).update(bodyCrudo).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(firmaHeader), Buffer.from(esperada));
}
```

Los webhooks `slack`/`teams` **no llevan firma** — ninguna de las dos
plataformas tiene ese concepto en sus webhooks entrantes, y la URL
generada en tu propio workspace es la única credencial.

## Payload

Un webhook `generic` recibe el evento completo:

```json
{
  "event": "ticket.created",
  "occurredAt": "2026-09-21T14:32:00.000Z",
  "data": { "...": "..." }
}
```

Un webhook `slack`/`teams` recibe un mensaje de texto plano ya formateado,
listo para publicar tal cual:

```json
{ "text": "🎫 New ticket #142: Printer jammed on 3rd floor" }
```

## Reintentos

Cada entrega corre en la cola de trabajos (BullMQ) con reintento y
backoff — una caída temporal de tu endpoint no pierde el evento. El
estado de la última entrega (éxito/error y cuándo) se ve directamente en
la lista de webhooks de la consola.

## Crear uno

```bash
curl -X POST https://tu-instancia.example.com/webhooks \
  -H "Authorization: Bearer <tu sesión de agente>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://tu-servidor.example.com/seredina-webhook",
    "events": ["ticket.created", "sla.first_response_breached"],
    "kind": "generic"
  }'
```

`kind` es opcional y por defecto es `generic`. Esta llamada usa tu propia
sesión de agente (no una API Key) porque es configuración de tenant, no un
endpoint público — hacela desde la consola en vez de a mano si no
necesitás automatizarlo.
