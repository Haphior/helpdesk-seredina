# Autenticación

Seredina tiene dos mecanismos de autenticación completamente separados,
para dos audiencias distintas — no los confundas entre sí.

## API Keys — para integraciones (lo que necesitás vos)

Si estás integrando algo externo (un formulario de contacto, tu propio
monitoreo, un script), **esto es lo que querés**. Las claves de API
autentican contra los endpoints públicos del canal API y de ingesta de
alertas (`/v1/tickets`, `/v1/alerts`, `/v1/alerts/grafana`) — nunca contra
la consola de agentes.

### Crear una clave

Desde la consola: **Administración → Claves de API → Nueva clave**. El
valor completo (con prefijo `sk_`) se muestra **una sola vez** al crearla
— Seredina solo guarda su hash, nunca el valor en texto plano, así que si
lo perdés hay que generar una clave nueva.

### Usarla

```bash
curl -X POST https://tu-instancia.example.com/v1/tickets \
  -H "Authorization: Bearer sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "No puedo acceder a mi cuenta",
    "body": "Intenté resetear la contraseña tres veces.",
    "contactEmail": "cliente@example.com",
    "contactName": "Ana Cliente"
  }'
```

La clave identifica el tenant automáticamente — no hace falta mandar un
`tenantId` en el body, el servidor lo resuelve a partir del hash de la
clave.

### Revocar una clave

Desde el mismo lugar donde la creaste — **Administración → Claves de
API**. Una clave revocada deja de funcionar de inmediato; cualquier
integración que la use empieza a recibir `401`.

## Sesión de agente (JWT) — para la consola web

Cuando un agente inicia sesión en la consola (`POST /auth/login`), recibe
un token JWT de corta duración que el navegador guarda y manda en cada
request subsecuente. **Este token es para la consola web, no para
integraciones externas** — no está pensado para ser usado por un script de
terceros, y sus permisos dependen del rol del agente (ver
[Administración](/guia/administracion) en la guía de usuario para roles y
permisos).

## Próximos pasos

- [API REST](/api/rest-api) — los endpoints públicos que una API Key puede
  llamar, en detalle.
- [Webhooks salientes](/api/webhooks) — la dirección contraria: Seredina
  notificándote a vos cuando algo pasa.
- [Servidor MCP](/api/mcp-server) — para conectar tu propio agente de IA
  (Claude Desktop, un flujo de n8n, un script) contra el mismo catálogo de
  herramientas que usa el copiloto.
- [Widget embebible](/api/widget) — un `<script>` que convierte cualquier
  sitio web en un canal de chat hacia Seredina.
