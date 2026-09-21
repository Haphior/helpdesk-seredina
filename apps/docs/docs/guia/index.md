# Primeros pasos

Esta guía cubre la consola de agentes: cómo usar cada funcionalidad desde
adentro, una vez que ya tenés una instancia corriendo. Si todavía no
instalaste Seredina, empezá por
[Instalación con Docker](/despliegue/).

## Crear tu organización

Visitá `/register` en tu instancia y completá el formulario — slug de
organización, tu nombre, email y contraseña. Ese primer registro te
convierte automáticamente en administrador; no hay un paso de bootstrap
por línea de comandos separado.

::: tip Un solo registro en modo autoalojado
Si tu instancia corre en `SEREDINA_MODE=self_hosted` (el modo por
defecto), solo se puede registrar una organización — es intencional, ver
[Modo cloud](/despliegue/modo-cloud) si necesitás más de una.
:::

## El checklist de primeros pasos

Al entrar por primera vez, el panel muestra un widget "Primeros pasos"
con cuatro tareas: personalizar tus estados de tickets, definir una
política de SLA, crear una macro, e invitar a un compañero de equipo. No
es obligatorio completarlo en orden — es una guía, no un flujo forzado, y
se puede ocultar en cualquier momento con el ícono de ojo en la esquina
del widget.

## Invitar a tu equipo

Todavía no existe un flujo de invitación por email — desde
**Administración → Usuarios**, un admin crea la cuenta directamente
(nombre, email, contraseña inicial, rol) y comparte la contraseña por
fuera de la aplicación. La persona invitada puede cambiarla después desde
su propio perfil.

## Cómo está organizada esta guía

La navegación de la izquierda sigue los mismos grupos que la barra
lateral de la propia consola:

- **[Tickets](/guia/tickets)** — la cola, el detalle, macros, fusión, acciones en lote
- **[SLA y escalamiento](/guia/sla-y-escalamiento)**
- **[CMDB y activos](/guia/cmdb-y-activos)** — activos, dispositivos con agente, catálogo de equipos
- **[Base de conocimiento](/guia/base-de-conocimiento)**
- **[Catálogo de servicios](/guia/catalogo-de-servicios)**
- **[Procesos, cambios y problemas](/guia/procesos-y-plantillas)**
- **[Copiloto de IA](/guia/copiloto-de-ia)**
- **[Canales de entrada](/guia/canales)** — correo, API, widget, Telegram, Slack/Teams, alertas
- **[Reportes y panel](/guia/reportes-y-panel)**
- **[Encuestas CSAT](/guia/encuestas-csat)**
- **[Administración](/guia/administracion)** — usuarios, roles, claves de API, apariencia, idioma
- **[Portal público](/guia/portal-publico)** — autoservicio y página de estado
