# Contactos y datos personales

**Contactos** (en la barra lateral, debajo de Tickets) lista a las personas
que escriben, por cualquier canal. Buscá por nombre o correo y abrí uno para
ver sus tickets. El nombre del contacto en un ticket también lleva ahí.

Las leyes de protección de datos, como la Ley 21.719 de Chile, el GDPR o la
LGPD de Brasil, le dan a cada persona el derecho a obtener una copia de sus
datos, corregirlos o pedir que se borren. El panel **Datos personales** en
la página de un contacto cubre los tres casos. Lo ven los roles con el
permiso **Gestionar los datos personales de los contactos**, que tienen los
administradores.

## Corregir un contacto

**Editar** cambia el nombre o el correo. Dos contactos no pueden compartir
dirección.

## Entregar una copia de sus datos

**Descargar datos** guarda un archivo JSON con:
- sus datos;
- sus tickets (asunto, estado, fechas, campos personalizados,
  calificación y comentario de satisfacción);
- la conversación, con los nombres de los adjuntos.

Las notas internas quedan afuera salvo que marques **Incluir notas
internas**. Son notas de trabajo de tu equipo, así que leelas antes de
enviarlas.

## Borrar sus datos

**Anonimizar contacto** borra los datos personales del contacto. Para
confirmar hay que escribir su correo. **No se puede deshacer.**

Qué se borra:
- su nombre y su correo;
- en cada uno de sus tickets: el asunto, todos los mensajes (también las
  respuestas y notas internas de tu equipo, porque citan al cliente), los
  adjuntos, los valores de campos personalizados y el comentario de
  satisfacción.

Qué queda: los tickets mismos, como registros vacíos con su número, estado,
equipo, responsable, fechas, tiempos de SLA y calificación. Tus reportes y
estadísticas no cambian hacia atrás.

Si la misma dirección vuelve a escribir, se la trata como un contacto nuevo.

::: warning Copias fuera de Seredina
Anonimizar no alcanza a las copias hechas en otros lados:
- los backups de la base de datos, hasta que se roten;
- los correos ya enviados;
- los datos que tus webhooks entregaron a otros sistemas;
- los artículos de la base de conocimiento escritos a partir de un ticket.
:::

## Retención automática

Arriba de la página Contactos, los administradores pueden activar la
**retención automática**: los contactos sin tickets abiertos ni actividad
durante una cantidad de días (entre 30 y 3650) se anonimizan solos. La
revisión corre cada algunas horas. Viene desactivada.

Cada exportación, corrección y anonimización, manual o automática, queda en
el [registro de auditoría](/es/guia/administracion#registro-de-auditoria).
El registro nombra al contacto solo por un id interno, así que no conserva
lo que se borró.
