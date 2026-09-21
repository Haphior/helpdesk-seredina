# Procesos, cambios y problemas

## Plantillas de proceso

Desde **Configuración → Plantillas de Procesos** se define una lista de
pasos reutilizable — por ejemplo, "Onboarding de nuevo empleado" con
cinco pasos fijos. Cada plantilla tiene un tipo:

| Tipo | Para qué |
|---|---|
| **General** | Cualquier checklist reutilizable (onboarding, offboarding, un procedimiento interno) |
| **Cambio** | Gestión de cambios (Change Enablement) — agrega nivel de riesgo, ventana planificada y plan de rollback |
| **Release** | Gestión de releases — agrega versión y, opcionalmente, el cambio que lo aprobó |

## Procesos (instancias en curso)

**Procesos** en la barra lateral muestra las instancias activas — un
proceso concreto arrancado a partir de una plantilla, con sus propios
pasos marcados como hechos o pendientes. Si la plantilla de origen se
borra después, la instancia sigue existiendo con el nombre de la plantilla
copiado en el momento de crearla, así nunca queda huérfana ni ilegible.

### Iniciar un cambio

Al arrancar una instancia desde una plantilla de tipo **Cambio**, hay que
indicar el nivel de riesgo — es el único campo obligatorio además de lo
básico. Ventana planificada (inicio/fin) y plan de rollback son opcionales
pero recomendados: útiles para quien revisa el cambio, no forzados por el
sistema.

### Iniciar un release

Igual que un cambio, pero pide la versión que se está desplegando en vez
del nivel de riesgo. Un release puede vincularse opcionalmente al cambio
que lo aprobó — el lugar natural donde una gestión de cambios le pasa la
posta a un release, una vez aprobado.

## Problemas

**Problemas** rastrea causas raíz, separado de los tickets individuales
que genera un mismo problema de fondo. Cada problema tiene estado (bajo
investigación, identificado, resuelto...), causa raíz y solución
temporal (workaround) mientras no hay arreglo definitivo.

Un problema puede vincularse a un ticket específico desde el propio
[detalle del ticket](/es/guia/tickets#el-panel-de-propiedades) — así varios
tickets causados por el mismo problema de fondo quedan agrupados y
visibles juntos — y, opcionalmente, al cambio que finalmente lo
solucionó de forma permanente: el flujo real de una gestión de problemas
suele terminar en un cambio.
