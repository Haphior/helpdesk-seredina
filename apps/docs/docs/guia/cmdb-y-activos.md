# CMDB y activos

La CMDB de Seredina tiene tres pantallas relacionadas pero distintas:
**Activos** (el inventario en sí), **Dispositivos** (el agente de
endpoint que lo alimenta automáticamente), y **Catálogo de Equipos** (los
modelos de hardware que podés asignarle a un activo).

## Activos

Cada fila es un servidor, estación de trabajo, dispositivo de red,
impresora o dispositivo móvil — con tipo, estado, IP, hostname, número de
serie, fabricante/modelo y sistema operativo. Un activo se puede vincular
a los tickets que lo afectan (desde el propio ticket, ver
[Tickets](/guia/tickets#el-panel-de-propiedades)), así queda un historial
de qué problemas tuvo cada equipo.

### Cómo llega un activo al inventario

- **Manual** — creado a mano desde **Nuevo Activo**.
- **Descubrimiento agentless** — escaneando un rango de red (TCP +
  SNMP) desde la propia pantalla de Activos. Encuentra lo que responde en
  la red, sin instalar nada en el equipo destino — con las limitaciones
  lógicas de esa técnica: si un equipo tiene el firewall cerrado o SNMP
  desactivado, no aparece.
- **Agente** — ver [Dispositivos](#dispositivos) abajo. Trae más detalle
  que el descubrimiento agentless porque corre *dentro* del equipo, no
  desde afuera.

## Dispositivos

**Dispositivos** es donde generás el comando de instalación del agente
liviano de Seredina (`apps/agent`, un script de Node.js sin firmar, sin
dependencias). Corriendo en un equipo real, reporta inventario de
hardware/software, versión de sistema operativo, si el disco está cifrado,
y estado del antivirus.

::: warning Solo inventario, por diseño permanente
El agente **nunca ejecuta nada remotamente** — ni scripts, ni despliegue
de software. No es una limitación temporal de esta versión: ejecución
remota e instaladores firmados exigen costos recurrentes (certificado de
firma de código, membresía de Apple Developer) que este proyecto de
código abierto sin financiamiento no puede sostener con responsabilidad.
Ver el [tour del MVP](https://github.com/Haphior/helpdesk-seredina) para
el razonamiento completo.
:::

Cada dispositivo enrolado aparece también en **Activos**, marcado con la
etiqueta "AGENT" como fuente de descubrimiento — es el mismo inventario,
solo con una columna extra indicando de dónde salió el dato. Revocar un
dispositivo desde esta pantalla corta sus futuros reportes sin borrar el
historial ya guardado.

## Catálogo de Equipos

Un catálogo de fabricantes y modelos de hardware (por ejemplo, "Dell" →
"Latitude 5540") — separado de los activos individuales. Asignarle un
modelo del catálogo a un activo precarga su tipo por defecto, pero el
activo mantiene su propio campo de tipo editable independiente: el
catálogo sugiere, no fuerza.
