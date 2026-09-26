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
[Tickets](/es/guia/tickets#el-panel-de-propiedades)), así queda un historial
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

**Dispositivos** es donde generás el comando de instalación del
[agente de Seredina](https://github.com/Haphior/seredina-agent). Es un solo
ejecutable para Windows, macOS y Linux (x86-64 y ARM64), y corre como
servicio. Cada hora reporta:

- Inventario de hardware y software, y la versión del sistema operativo.
- Si el disco está cifrado.
- El estado del antivirus.
- Los equipos que ve en su red local.

Para agregar un equipo:

1. Hacé clic en **Generar comando de inscripción**.
2. Elegí el sistema operativo del equipo.
3. Ejecutá el comando ahí como administrador. Vale 15 minutos y funciona una sola vez.

| Sistema | Dónde ejecutarlo |
|---|---|
| Windows | PowerShell abierto como administrador |
| macOS / Linux | Una terminal (usa `sudo`) |
| Ya descargado | La carpeta del agente, para un equipo sin acceso a internet |

El comando descarga el agente, verifica su SHA-256, inscribe el equipo y
deja el servicio corriendo. Si tu servidor usa un certificado privado, el
comando además lleva su CA. El agente confía solo en esa CA y nunca
desactiva la verificación del certificado.

Si tus equipos no llegan a GitHub, copiá los archivos de una versión
(`install.sh`, `install.ps1`, los archivos comprimidos y `SHA256SUMS`) a un
servidor web interno. Poné la dirección de esa carpeta en
`AGENT_DOWNLOAD_URL`, en el `.env`. Los comandos van a descargar de ahí.

`seredina-agent status` muestra si el equipo está inscrito y si el servicio
corre. `seredina-agent uninstall --purge` quita el agente. Para
actualizarlo, ejecutá un comando de inscripción nuevo: el equipo conserva
su registro.

::: warning Solo inventario, por diseño permanente
El agente **nunca ejecuta nada remotamente** — ni scripts, ni despliegue
de software. No es una limitación temporal de esta versión: ejecución
remota necesita un canal de entrega firmado y auditado que este proyecto
de código abierto sin financiamiento no puede mantener con
responsabilidad. Las versiones del agente tampoco están firmadas todavía:
SmartScreen o Gatekeeper pueden advertir si abrís el ejecutable a mano,
pero los comandos de instalación no se ven afectados.
Ver el [tour del MVP](https://github.com/Haphior/helpdesk-seredina) para
el razonamiento completo.
:::

Cada dispositivo enrolado aparece también en **Activos**, marcado con la
etiqueta "AGENT" como fuente de descubrimiento — es el mismo inventario,
solo con una columna extra indicando de dónde salió el dato. Revocar un
dispositivo desde esta pantalla corta sus futuros reportes sin borrar el
historial ya guardado.

## Contratos, garantías y licencias

**CMDB → Contratos** registra contratos de soporte, garantías, licencias de
software, arriendos y suscripciones: proveedor, número de contrato u orden,
fechas de inicio y término, costo (pago único, mensual o anual, en
cualquier moneda), puestos para licencias, y los activos que cubre cada uno.
La página de cada activo muestra los contratos que lo cubren.

Cada contrato indica si está vigente, por vencer o vencido. El encabezado
de la página suma lo que está por vencer, lo vencido y el costo recurrente
anual por moneda. **Avisar días antes** (30 por defecto) controla el aviso
de renovación: cuando un contrato entra en ese plazo, todas las personas
cuyo rol puede gestionar activos reciben una notificación *Contrato por
vencer*, en la aplicación y por correo si lo activaron en sus preferencias
de notificación. Hay un aviso por fecha de término; cambiar la fecha (una
renovación) lo vuelve a activar.

No pongas claves de licencia en estos campos: los ve cualquiera que pueda
ver los activos y se incluyen en las exportaciones de datos.

## Catálogo de Equipos

Un catálogo de fabricantes y modelos de hardware (por ejemplo, "Dell" →
"Latitude 5540") — separado de los activos individuales. Asignarle un
modelo del catálogo a un activo precarga su tipo por defecto, pero el
activo mantiene su propio campo de tipo editable independiente: el
catálogo sugiere, no fuerza.
