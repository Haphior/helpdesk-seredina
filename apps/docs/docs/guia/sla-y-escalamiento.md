# SLA y escalamiento

## Políticas de SLA

Desde **Configuración → Políticas de SLA** se define, por prioridad
(Baja/Normal/Alta/Urgente), en cuántos minutos debe llegar la primera
respuesta y en cuántos debe resolverse el ticket. Cada prioridad tiene su
propia política — un ticket urgente típicamente tiene plazos mucho más
cortos que uno de baja prioridad.

Cada política tiene un interruptor **solo horario laboral**: si está
activado, el conteo de tiempo se pausa fuera del horario configurado en
**Operaciones → Horario Laboral** (zona horaria y ventanas por día de la
semana) — un ticket urgente abierto un viernes a la noche no empieza a
"vencer" hasta que vuelva a abrir la oficina.

## Cómo se ve en un ticket

En el panel de propiedades del [detalle de un ticket](/guia/tickets#el-panel-de-propiedades),
si aplica una política de SLA, se muestra cuándo se cumplió la primera
respuesta y la resolución (en verde) o cuándo vencen si todavía no
ocurrieron (en rojo si ya está vencido). En la cola de tickets, un ícono
de reloj junto al asunto marca los tickets con el SLA vencido, sin
necesidad de abrir cada uno.

## Escalamiento

El escalamiento es una cadena de niveles ("tiers"), cada uno con un
tiempo de espera propio (**Operaciones → Guardia y Escalamiento**). Un
nivel puede apuntar a una persona específica o a un
[calendario de guardia](#guardia-on-call) — si nadie reconoce la alerta
dentro del tiempo del nivel actual, pasa automáticamente al siguiente.

Un ticket con escalamiento activo muestra un aviso en el detalle con un
botón **Confirmar** — cualquier agente con acceso puede reconocerlo, lo
que detiene el avance a niveles siguientes. Si se agotan todos los
niveles sin que nadie confirme, el escalamiento queda en estado agotado —
es un estado final en esta versión, no reintenta.

## Guardia (on-call)

Un calendario de guardia define quién está de turno en cada momento —
un nivel de escalamiento puede apuntar a un calendario en vez de a una
persona fija, así la alerta siempre llega a quien esté de guardia esa
semana, sin tener que reconfigurar la cadena de escalamiento cada vez que
cambia el turno.
