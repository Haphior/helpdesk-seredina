# Copiloto de IA

El copiloto tiene tres modos, de menos a más autónomo, todos disponibles
desde el mismo [detalle de un ticket](/es/guia/tickets#el-panel-de-propiedades).

## Resumir

El botón **Resumir** genera un resumen corto del ticket completo — útil
para retomar un caso viejo o pasarlo a otro agente sin releer todo el
hilo desde cero. Se muestra en un panel destacado arriba de los mensajes,
no reemplaza el historial real.

## Sugerir respuesta

**Sugerir respuesta** redacta un borrador basado en el contenido del
ticket y, cuando encuentra algo relevante, en artículos publicados de la
[base de conocimiento](/es/guia/base-de-conocimiento) (búsqueda por
similitud semántica, no coincidencia exacta de palabras). El borrador
aparece directamente en el cuadro de respuesta — el agente lo edita o lo
manda tal cual, nunca se envía solo. Si usó algún artículo, aparece
listado como "Basado en:" debajo del cuadro.

## Modo autónomo ("Dejar que la IA lo intente")

Acá el copiloto puede investigar el ticket y, si tiene confianza,
**actuar** sobre él — no solo redactar texto. La diferencia clave con los
dos modos anteriores es que sí puede ejecutar herramientas reales
(consultar datos, cambiar el estado, asignar, aplicar una macro, agregar
una respuesta), sujeto siempre a la Política de Autonomía del tenant.

### Política de Autonomía

Desde **Operaciones → Actividad del Agente de IA** se configura:

- **Lista de herramientas de auto-ejecución** — solo las herramientas
  explícitamente permitidas ahí se ejecutan de inmediato. Cualquier otra
  llamada queda en estado "pendiente de aprobación" para que un humano la
  revise antes de que pase algo.
- **Límite de acciones por día** — un tope duro, independiente de cuántas
  estén aprobadas para auto-ejecutarse.

Cada llamada —auto-ejecutada o pendiente— queda registrada en un mismo
historial de auditoría, con la herramienta usada, los argumentos, el
resultado, y de dónde vino la llamada (el copiloto interno o un agente
externo vía [servidor MCP](/es/api/mcp-server) — comparten exactamente el
mismo catálogo y las mismas reglas, no hay un camino separado con menos
control para integraciones externas).

## Transparencia de costos de IA

**Operaciones → Uso de IA** muestra el costo real en dólares de cada
llamada al copiloto, agregado por tenant. Como la clave del proveedor de
IA puede ser la propia del tenant (traé tu propia clave, desde
**Configuración → IA**), Seredina nunca le agrega margen — el costo
mostrado es exactamente lo que cobra el proveedor.

## Sin proveedor de IA configurado

Si ni el tenant ni el despliegue tienen una clave de IA configurada, estos
tres botones responden con un error claro en vez de fallar
silenciosamente o bloquear el resto de la app — el resto de Seredina
funciona igual de bien sin IA configurada. Ver
[Variables de entorno](/es/despliegue/variables-de-entorno#copiloto-de-ia-opcional)
para configurar un proveedor a nivel de despliegue.
