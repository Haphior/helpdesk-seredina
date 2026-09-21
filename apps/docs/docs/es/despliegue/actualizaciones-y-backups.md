# Actualizaciones y backups

## Actualizar tu instancia

No hay un mecanismo de auto-actualización — es un `git pull` y volver a
levantar los contenedores:

```bash
git pull origin main
docker compose -f infra/docker-compose.yml up -d --build
```

El servicio `migrate` corre de nuevo automáticamente como parte del
arranque y aplica cualquier migración de esquema nueva antes de que `api`
empiece a recibir tráfico. No hay un paso manual de "correr las
migraciones" aparte.

::: tip Antes de actualizar en producción
Mirá el changelog de commits desde tu última actualización
(`git log <tu-commit-actual>..origin/main --oneline`) y, si te preocupa
algo específico, revisá el ADR correspondiente en `docs/adr/` — cada
decisión de arquitectura no trivial tiene una entrada ahí explicando el
porqué, no solo el qué.
:::

## Backups

Seredina no trae backups automatizados — es un Postgres estándar corriendo
en un contenedor, y las herramientas estándar de Postgres son las que
usás:

```bash
# Backup completo
docker compose -f infra/docker-compose.yml exec postgres \
  pg_dump -U app_migrator seredina > backup-$(date +%Y%m%d).sql

# Restaurar
docker compose -f infra/docker-compose.yml exec -T postgres \
  psql -U app_migrator seredina < backup-20260101.sql
```

Para producción real, correlo con cron o el mecanismo de backup de tu
proveedor de infraestructura — Seredina no asume nada sobre dónde corre
Postgres ni cómo programás backups.

### Lo que también necesitás respaldar

Un `pg_dump` de la base de datos **no alcanza por sí solo**:

- **`ENCRYPTION_KEY`**: sin esta clave exacta, cada contraseña de canal de
  correo guardada (cifrada con AES-256-GCM) queda indescifrable para
  siempre, aunque restaures la base de datos perfectamente. Guardala con
  la misma seriedad que la contraseña de la base de datos misma.
- **`JWT_SECRET`**: si lo perdés, no perdés datos, pero cada sesión activa
  queda inválida — no es catastrófico, solo molesto.

### Exportación de datos por tenant

Aparte del backup de infraestructura, cada tenant tiene su propia
exportación completa en un formato abierto: **Configuración → Exportar
Datos** en la consola (o `GET /export` directamente) devuelve un único
JSON con las ~35 tablas propias de ese tenant. Es la respuesta honesta al
"portabilidad de datos": migrar *fuera* de Seredina es un clic, no un
proceso deliberadamente doloroso como en otras herramientas cuyo modelo de
negocio depende de que te cueste irte. Los secretos (hashes de
contraseñas, claves de API, credenciales cifradas) se excluyen siempre del
export — nunca viajan fuera de la base de datos.

Esto es portabilidad de datos por tenant, no un reemplazo de un backup real
de infraestructura — usalo para migrar o auditar, no como tu única copia de
seguridad.
