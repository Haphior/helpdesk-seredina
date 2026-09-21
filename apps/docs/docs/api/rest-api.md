# API REST

La API pública (autenticada con [API Keys](/api/#api-keys-para-integraciones-lo-que-necesitás-vos))
es deliberadamente chica: crear tickets desde afuera y convertir alertas de
monitoreo en tickets. No es un CRUD completo — la consola web habla con
una API interna mucho más grande (`/tickets`, `/users`, `/assets`, ...),
pero esa está pensada para el propio frontend de Seredina, autenticada por
sesión de agente, no para integraciones de terceros.

Todos los endpoints devuelven JSON. Un body inválido devuelve `400` con el
detalle de validación de [Zod](https://zod.dev); una clave inválida o
ausente devuelve `401`.

## `POST /v1/tickets`

Crea un ticket como si llegara desde un formulario de contacto o una
integración propia — el canal queda registrado como `api`.

```bash
curl -X POST https://tu-instancia.example.com/v1/tickets \
  -H "Authorization: Bearer sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "No puedo acceder a mi cuenta",
    "body": "Intenté resetear la contraseña tres veces.",
    "contactEmail": "cliente@example.com",
    "contactName": "Ana Cliente",
    "priority": "HIGH"
  }'
```

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `subject` | string | Sí | 1–200 caracteres |
| `body` | string | Sí | El primer mensaje del ticket |
| `contactEmail` | string | Sí | Email válido |
| `contactName` | string | Sí | |
| `priority` | `LOW` \| `NORMAL` \| `HIGH` \| `URGENT` | No | `NORMAL` si se omite |

Devuelve `201` con el ticket creado.

## `POST /v1/alerts`

El punto de entrada genérico para NOC/SOC: cualquier herramienta de
monitoreo que pueda hacer un `POST` con un token Bearer puede convertir
una alerta en un ticket. Es el mismo mecanismo que usan las integraciones
específicas (Grafana, Zabbix) por debajo.

```bash
curl -X POST https://tu-instancia.example.com/v1/alerts \
  -H "Authorization: Bearer sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "source": "zabbix",
    "severity": "HIGH",
    "title": "Disco al 95% en db-prod-01",
    "description": "Partición /var/lib/postgresql al 95% de uso.",
    "externalId": "zbx-88213"
  }'
```

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `source` | string | Sí | 1–100 caracteres — el nombre de la herramienta que manda la alerta |
| `severity` | `CRITICAL` \| `HIGH` \| `MEDIUM` \| `LOW` \| `INFO` | No | Mapea a la prioridad del ticket |
| `title` | string | Sí | 1–200 caracteres |
| `description` | string | No | |
| `externalId` | string | No | El id de la alerta en el sistema de origen — útil para deduplicar |

## `POST /v1/alerts/grafana`

Igual que `/v1/alerts`, pero acepta directamente el payload nativo que
manda el "contact point" webhook de Grafana Alerting — no hace falta
transformar nada del lado de Grafana, solo apuntar la URL y poner
`Authorization: Bearer sk_...` en el header custom que Grafana permite
configurar. Ver
[Monitoreo e integraciones](/guia/canales#alertas-de-monitoreo-noc-soc) en
la guía de usuario para la configuración paso a paso desde Grafana/Zabbix.

## Errores

| Código | Cuándo |
|---|---|
| `400` | El body no pasa la validación — la respuesta incluye el detalle campo por campo |
| `401` | Falta el header `Authorization`, o la clave no es válida/fue revocada |
| `201` | Éxito — devuelve el recurso creado |
