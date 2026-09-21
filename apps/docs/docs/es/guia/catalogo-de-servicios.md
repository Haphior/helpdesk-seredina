# Catálogo de servicios

Dos pantallas con nombres parecidos que hacen cosas distintas — vale la
pena distinguirlas de entrada:

| Pantalla | Grupo en el menú | Para qué |
|---|---|---|
| **Catálogo de Servicios** | Configuración | Ítems que un usuario puede *pedir* — arman un ticket con campos precargados |
| **Servicios** | CMDB | Servicios de negocio reales (Email, VPN, Facturación...) mapeados a los activos que los sostienen |

## Catálogo de Servicios (pedidos)

Cada ítem del catálogo (nombre, descripción, ícono opcional) puede llevar
un conjunto de [campos personalizados](/es/guia/administracion#campos-personalizados)
asociados — al elegir ese ítem desde **Nuevo ticket → Desde catálogo**, el
formulario se arma solo con esos campos en vez de un formulario genérico.
"Solicitar una laptop nueva" y "Reportar un problema de red" pueden pedir
datos completamente distintos porque son ítems de catálogo distintos.

## Servicios (configuración de servicios)

Un servicio real de tu operación — "Email corporativo", "VPN", "Facturación"
— vinculado a los [activos de CMDB](/es/guia/cmdb-y-activos) que lo sostienen.
Cuando un ticket tiene un activo vinculado que forma parte de un servicio,
el panel del ticket muestra qué servicio queda afectado — así un agente ve
de un vistazo el impacto real de un activo caído, no solo el nombre del
equipo.
