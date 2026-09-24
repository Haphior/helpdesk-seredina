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
usás.

```bash
# Backup completo, en el formato comprimido propio de Postgres. Correlo
# desde la raíz del repositorio. El -T importa: sin él docker asigna una
# terminal y puede corromper la salida binaria.
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_dump -U app_migrator -Fc seredina > seredina-$(date +%Y%m%d-%H%M).dump
```

Programalo con cron (o con el mecanismo de backup de tu proveedor) y
copiá el archivo **fuera de la máquina** — un backup en el mismo disco que
la base de datos no sobrevive a ese disco. Por ejemplo, todas las noches a
las 02:30 guardando 14 días:

```text
30 2 * * * cd /opt/seredina && docker compose -f infra/docker-compose.yml exec -T postgres pg_dump -U app_migrator -Fc seredina > /var/backups/seredina/seredina-$(date +\%Y\%m\%d).dump && find /var/backups/seredina -name '*.dump' -mtime +14 -delete
```

Si Postgres no corre en este compose (una base administrada), usá los
snapshots de tu proveedor o apuntá el mismo `pg_dump` a esa base.

### Restaurar

Restaurá sobre una base de datos **vacía** y dejá que `migrate` termine el
trabajo: recrea el rol `app_tenant` con la contraseña de tu `.env` y vuelve
a aplicar las políticas de seguridad por fila y los permisos, que no
forman parte de un volcado de tablas.

```bash
# 1. Detené todo y levantá solo Postgres, con un volumen vacío.
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d postgres

# 2. Cargá el volcado.
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_restore -U app_migrator -d seredina --no-owner --no-privileges < seredina-20260101-0230.dump

# 3. Levantá el resto; migrate corre primero, como en cada arranque.
docker compose -f infra/docker-compose.yml up -d
```

`down -v` borra el volumen de la base de datos actual — corrélo solo
cuando de verdad quieras reemplazar esos datos. Probá restaurar en una
máquina de prueba de vez en cuando: un backup que nunca restauraste es una
suposición, no un backup.

### Lo que también necesitás respaldar

Un volcado de la base de datos **no alcanza por sí solo**. Guardá una copia
de tu `.env` en un lugar seguro y separado de los volcados — en especial:

- **`ENCRYPTION_KEY`**: cifra (AES-256-GCM) todos los secretos guardados:
  contraseñas de canales de correo y tokens OAuth de Gmail/Microsoft 365,
  secretos de cliente de SSO, secretos de MFA de los usuarios, claves de
  proveedores de IA, secretos de firma de webhooks y tokens de bots de
  Telegram. Si restaurás la base con otra clave, todo eso queda ilegible
  para siempre: hay que reconectar los buzones, reconfigurar el SSO y
  **un administrador tiene que restablecer el MFA de cada usuario**.
  Guardala como la contraseña de la base de datos misma — y nunca en el
  mismo lugar que los volcados, o con un solo backup robado alcanza para
  leer todos los secretos.
- **`JWT_SECRET`**: si lo perdés, no perdés datos, pero cada sesión activa
  queda inválida — no es catastrófico, solo molesto.
- **`APP_TENANT_DB_PASSWORD`** y **`POSTGRES_PASSWORD`**: no hacen falta
  para leer el volcado, pero restaurar con el mismo `.env` evita sorpresas.
- Si usás el perfil `proxy` con tu propio certificado, los archivos de
  `certs/`. Los certificados de Let's Encrypt se vuelven a emitir solos.

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
