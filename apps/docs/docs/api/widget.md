# Widget embebible

Una burbuja de chat flotante para cualquier sitio web propio — sin login,
sin API Key, funciona desde cualquier dominio.

## Instalación

Un único `<script>` en cualquier página:

```html
<script src="https://tu-instancia.example.com/widget.js" data-tenant="tu-organizacion"></script>
```

`data-tenant` es el slug de tu organización (el mismo que usás para
iniciar sesión). Eso es todo — no hace falta configurar CORS del lado del
sitio que lo embebe ni generar ninguna credencial.

## Cómo funciona

Un visitante que escribe en la burbuja genera un ticket normal en
Seredina, con `channel: "widget"` — los agentes lo ven y responden en la
cola de tickets exactamente igual que cualquier otro canal.

La continuidad de la conversación entre visitas (que el visitante siga
viendo el mismo hilo si vuelve a la página) se maneja con un token
aleatorio que el propio navegador del visitante guarda en
`localStorage` — no hay una cuenta ni un login de por medio. Si el
visitante limpia el `localStorage` o cambia de navegador, empieza una
conversación nueva.

## Seguridad

El widget funciona desde cualquier dominio a propósito — es lo que lo hace
embebible en tu sitio sin configuración adicional — pero eso no debilita
el resto de la política CORS de la API, que sigue restringida
normalmente para el resto de los endpoints. El manejo de CORS específico
del widget está documentado en detalle en
`docs/adr/0040-embeddable-widget.md` si te interesa el porqué técnico.
