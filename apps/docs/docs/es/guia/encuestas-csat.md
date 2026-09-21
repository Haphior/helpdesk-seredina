# Encuestas CSAT

Cuando un ticket pasa a estado resuelto, Seredina genera automáticamente
un link de encuesta de satisfacción (1 a 5 estrellas, más un comentario
opcional) y lo entrega al contacto por el mismo canal por el que ya venía
hablando — correo, Telegram, o la conversación del widget — sin
configuración adicional por tu parte. Se pide **como máximo una vez por
ticket**, nunca se re-envía.

::: tip Requiere `WEB_ORIGIN` configurada
Sin esa variable de entorno, la encuesta simplemente no se genera —
degrada de forma silenciosa, no rompe el resto del flujo de resolución del
ticket. Ver [Variables de entorno](/es/despliegue/variables-de-entorno#red-y-puertos).
:::

## Dónde se ve

- El promedio de todas las respuestas, últimos 90 días, en el widget
  **Satisfacción del cliente** del [panel](/es/guia/reportes-y-panel).
- La respuesta a una encuesta específica no aparece como un mensaje
  normal del ticket — es un registro separado, pensado para agregarse en
  reportes, no para revisarse ticket por ticket.

## El lado del contacto

El link lleva a una página pública simple, sin cuenta ni login — el token
en la URL es la única credencial, el mismo patrón que usa el widget de
chat para identificar una conversación sin requerir una sesión.
