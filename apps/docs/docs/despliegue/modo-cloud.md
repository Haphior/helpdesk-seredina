# Modo cloud (multi-tenant)

Seredina no tiene un fork "cloud" separado ni una imagen distinta. La misma
base de código, los mismos contenedores, corren en ambos modos — la única
diferencia real es una variable de entorno: `SEREDINA_MODE`.

## Qué cambia realmente

`SEREDINA_MODE=self_hosted` (el valor por defecto) hace que el registro de
una segunda organización falle explícitamente:

> `this self-hosted instance already has a tenant -- self-hosted mode
> supports exactly one`

Es arquitectónicamente de un solo tenant: pensado para que una empresa lo
instale para sí misma, no para revender acceso a terceros. El primer
registro (el que crea tu propia organización) funciona normalmente; el
segundo intento de `/register` es el que se bloquea.

`SEREDINA_MODE=cloud` quita ese límite — cualquiera puede registrar su
propia organización en `/register`, cada una aislada de las demás por
Row-Level Security de Postgres (ver la
[arquitectura de multi-tenancy](https://github.com/Haphior/helpdesk-seredina/blob/main/docs/adr/0001-multi-tenancy-rls.md)
si te interesa el detalle técnico). Esto es lo que necesitás si vas a
operar Seredina como tu propio servicio para múltiples clientes.

## Lo que el modo cloud *no* incluye todavía

Sé directo sobre esto en vez de dar a entender que es un interruptor
"activar y listo":

- **Sin niveles de precio ni facturación.** No hay un modelo de planes/
  billing construido — es una decisión de negocio deliberadamente no
  tomada por el código, no un olvido técnico.
- **Sin infraestructura de producción incluida.** `docker compose` te da
  contenedores corriendo; TLS, dominio propio, backups automatizados,
  monitoreo y alta disponibilidad son responsabilidad de quien opera el
  servicio, igual que con cualquier otro software autoalojado.
- **Sin Términos de Servicio ni Política de Privacidad.** Si vas a procesar
  datos reales de clientes en tu propia infraestructura, esos documentos
  (y el cumplimiento de GDPR si tenés usuarios en la UE) son tuyos que
  resolver — Seredina no asume nada sobre tu situación legal.

## Aislamiento entre tenants

Cada fila de cada tabla con datos de tenant lleva un `tenant_id`, y
Postgres aplica Row-Level Security a nivel de base de datos — no es una
cláusula `WHERE tenantId = ...` que un desarrollador podría olvidar
agregar en una query nueva. El rol `app_tenant` (el único con el que `api`
y `worker` se conectan) físicamente no puede leer ni escribir filas fuera
del contexto de tenant activo en esa transacción.
