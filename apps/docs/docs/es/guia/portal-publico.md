# Portal público

Dos páginas públicas, sin cuenta ni login, en la URL de tu instancia —
para tus clientes, no para tus agentes.

## Base de conocimiento pública

`/kb/tu-organizacion` — todo artículo publicado desde la
[gestión interna de la base de conocimiento](/es/guia/base-de-conocimiento),
con su propio buscador. No hace falta configurar nada aparte: publicar un
artículo lo hace aparecer ahí automáticamente.

## Página de estado

`/status/tu-organizacion` — muestra el estado de cada
[servicio de negocio configurado](/es/guia/catalogo-de-servicios#servicios-configuración-de-servicios)
(operativo, degradado, o caído).

::: tip Se mantiene sola, sin trabajo manual
No hay un botón para "marcar un servicio como caído" — el estado se
calcula automáticamente a partir de si hay tickets de canal **alerta**
abiertos vinculados a los activos que sostienen ese servicio. Prioridad
Alta o Urgente en la alerta marca el servicio como caído; cualquier otra
alerta abierta lo marca como degradado; sin alertas abiertas, operativo.
Configurá bien tus [Servicios](/es/guia/cmdb-y-activos) y tus
[alertas de monitoreo](/es/guia/canales#alertas-de-monitoreo-noc-soc) una vez,
y la página de estado queda correcta sola de ahí en adelante.
:::

Un visitante anónimo solo ve el nombre del servicio y su color de
estado — nunca el asunto ni la descripción del ticket que lo está
afectando. Un ticket rutinario ("cambiar un teclado") vinculado al mismo
activo no afecta el estado público — solo cuentan los tickets que
llegaron por el canal de alerta.

## Marca en las páginas públicas

Si configuraste [marca blanca](/es/guia/administracion#marca-blanca), ambas
páginas públicas muestran tu logo y color de acento en vez de los de
Seredina — es la superficie pensada exactamente para eso.
