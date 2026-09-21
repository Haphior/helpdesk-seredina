# Base de conocimiento

## Gestión interna

Desde **Base de Conocimiento** en la barra lateral, cualquier agente con
permiso de escritura puede crear artículos (título + cuerpo) y marcarlos
como publicados o no. Un artículo sin publicar solo es visible en la
consola — nunca aparece en el portal público ni en las búsquedas del
copiloto de IA.

## Portal público

Cada artículo publicado es visible sin cuenta en
`https://tu-instancia.example.com/kb/tu-organizacion` — la misma URL
aparece como referencia directamente en la pantalla de gestión, lista
para compartir. El portal tiene su propio buscador de texto libre.

## Conexión con el copiloto de IA

Cuando un agente pide **Sugerir respuesta** en un ticket, el copiloto
busca por similitud semántica (RAG, sobre `pgvector`) entre los artículos
publicados y, si encuentra alguno relevante, lo usa para redactar la
sugerencia y lo muestra como "Basado en:" debajo del cuadro de respuesta
— así el agente sabe de dónde salió la sugerencia antes de enviarla, en
vez de confiar a ciegas en el texto generado. Ver
[Copiloto de IA](/guia/copiloto-de-ia) para el resto de lo que hace el
copiloto.

Mantener la base de conocimiento actualizada no es solo para los clientes
que la leen en el portal público — mejora directamente la calidad de las
respuestas sugeridas por IA en cada ticket nuevo.
