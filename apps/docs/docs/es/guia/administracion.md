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

## Verificación en dos pasos

Cada usuario puede activar la verificación en dos pasos en **Seguridad de la
cuenta** (el ícono de escudo al pie de la barra lateral): escanea el código
QR con una app de autenticación (Microsoft Authenticator, Google
Authenticator, 1Password, Authy…) y escribe el código de 6 dígitos. Desde
entonces, al iniciar sesión se pide un código después de la contraseña. Se
muestran una sola vez diez **códigos de recuperación**: guárdalos en un lugar
seguro, cada uno sirve para entrar una vez si pierdes el teléfono.

En **Administración → Usuarios**, un administrador puede:

- **Exigir la verificación en dos pasos a todos.** A quien no la tenga se le
  guía para configurarla en su próximo inicio de sesión, y no puede
  desactivarla mientras sea obligatoria. Tú debes tenerla activada primero.
- **Restablecer** la verificación de un usuario que perdió su teléfono.
  Entrará solo con su contraseña y la configurará de nuevo.

Los códigos incorrectos cuentan para el mismo bloqueo de 5 intentos que las
contraseñas incorrectas.

## Registro de auditoría

**Administración → Registro de auditoría** muestra la actividad relevante
para la seguridad: inicios de sesión (exitosos y fallidos, con dirección IP
y navegador), bloqueos de cuenta, usuarios creados, desactivados o con un
rol nuevo, cambios de roles, claves de API, webhooks, canales de correo,
Telegram, agentes de equipos, configuración de IA, configuración del portal
de conocimiento y exportaciones completas de datos. Cada entrada indica
quién lo hizo, sobre qué, cuándo y desde dónde. Los secretos nunca se
registran: cambiar una clave de API deja constancia de *que* cambió, no de
su valor.

Las entradas son de solo inserción: el rol de base de datos de la propia
aplicación puede agregarlas y leerlas, nunca modificarlas ni borrarlas. Ver
el registro requiere el permiso `audit:read`, que tiene el rol de
administrador incorporado (también en instalaciones existentes, después de
actualizar).

## Claves de API

**Administración → Claves de API** — para integraciones externas, no
para agentes humanos. Ver [Autenticación](/es/api/#api-keys-para-integraciones-lo-que-necesitás-vos)
para el detalle completo.

## Campos personalizados

**Configuración → Campos Personalizados** — definí campos extra que
aparecen en el panel de propiedades de cada ticket. Cinco tipos
disponibles: texto, número, sí/no, fecha, y lista de opciones. Un campo
personalizado también puede asociarse a un
[ítem del catálogo de servicios](/es/guia/catalogo-de-servicios#catálogo-de-servicios-pedidos),
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
el [portal de autoservicio y la página de estado pública](/es/guia/portal-publico)
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
