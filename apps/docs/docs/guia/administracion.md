# Administración

## Usuarios y roles

**Administración → Usuarios** crea cuentas directamente (nombre, email,
contraseña inicial, rol) — no hay flujo de invitación por email todavía,
la contraseña se comparte por fuera de la aplicación.

Tres roles vienen predefinidos, y cada uno se puede editar o se pueden
crear roles completamente nuevos desde **Administración → Roles**:

| Rol | Permisos por defecto |
|---|---|
| `admin` | Todo — usuarios, roles, tickets, activos, canales |
| `team_lead` | Tickets (incluyendo los de otros agentes), activos, canales — sin gestión de usuarios/roles |
| `agent` | Leer y responder tickets propios, ver activos — sin gestionar nada |

Los permisos son granulares (`tickets:read`, `tickets:write`,
`tickets:manage_all`, `assets:read`, `assets:manage`, `channels:manage`,
`users:manage`, `roles:manage`) — un rol personalizado puede combinarlos
como necesites, no estás atado a los tres roles de fábrica.

## Claves de API

**Administración → Claves de API** — para integraciones externas, no
para agentes humanos. Ver [Autenticación](/api/#api-keys-para-integraciones-lo-que-necesitás-vos)
para el detalle completo.

## Campos personalizados

**Configuración → Campos Personalizados** — definí campos extra que
aparecen en el panel de propiedades de cada ticket. Cinco tipos
disponibles: texto, número, sí/no, fecha, y lista de opciones. Un campo
personalizado también puede asociarse a un
[ítem del catálogo de servicios](/guia/catalogo-de-servicios#catálogo-de-servicios-pedidos),
así distintos tipos de solicitud piden datos distintos.

## Apariencia

**Administración → Apariencia** — dos temas visuales para toda la
consola, con efecto inmediato para cualquiera que la tenga abierta:

- **Meet in the Middle** (por defecto) — paleta piedra cálida, con un
  glifo de tres círculos en cada ticket indicando por qué canal llegó.
- **Refined** — el look original, paleta slate fría, sin el glifo.

Es una preferencia por tenant, no por persona — todos los agentes de una
misma organización ven el mismo tema.

## Marca blanca

**Administración → Marca** — logo y color de acento propios, visibles en
el [portal de autoservicio y la página de estado pública](/guia/portal-publico)
que ven tus clientes. La consola interna de agentes mantiene la identidad
de Seredina — el white-label es para las superficies que da la cara al
público, no para reemplazar la marca puertas adentro.

## Idioma

Un selector de idioma vive en la parte inferior de la barra lateral — es
una preferencia **por persona**, guardada en el navegador, no por tenant:
dos agentes del mismo equipo pueden usar la consola en idiomas distintos
sin pisarse. Cubre hoy inglés y español, en las pantallas de mayor uso
(login, navegación, panel, tickets) — el resto de la consola todavía se ve
en inglés.
