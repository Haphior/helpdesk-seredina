# Producción en un servidor de la empresa

Esta página lleva Seredina de una instalación de prueba a producción, en un
servidor dentro de la red de tu empresa. Sigue a las otras páginas de
despliegue y agrega lo que cambia en una red interna:

- El DNS.
- Los certificados.
- El firewall.
- Qué funciona y qué no sin ser accesible desde internet.

## 1. El servidor

- **Sistema operativo.** Cualquier Linux con Docker Engine y el plugin
  `docker compose`. Los ejemplos usan Ubuntu Server 24.04 LTS.
- **Tamaño.** Para un equipo chico o mediano, empezá con 2 vCPU, 4 GB de
  RAM y 40 GB de disco. Sumá más si tenés mucho historial de tickets o
  muchos adjuntos. Con la opción de IA local (Ollama), sumá la memoria que
  necesite tu modelo.
- **Dirección.** Dale al servidor una IP fija, o una reserva en el DHCP.
- **Acceso de administración.** Solo quienes lo administran deberían
  tener acceso por SSH. Mantené el sistema al día con actualizaciones de
  seguridad automáticas (`unattended-upgrades` en Ubuntu).

## 2. Un nombre para el servidor

Elegí la dirección que la gente va a escribir y creala en tu DNS interno
(el DNS de Active Directory, tu router, etc.) apuntando al servidor.

**Usá un nombre bajo el dominio real de tu empresa**, aunque solo se
resuelva dentro de la red, por ejemplo `helpdesk.tuempresa.cl`, en vez de
`helpdesk.local` o una IP. Google solo acepta direcciones de redirección
OAuth bajo un dominio de nivel superior público. Con un nombre `.local`, o
una IP, quedan afuera los buzones de Gmail y el inicio de sesión con
Google. El nombre no necesita ser accesible desde internet: solo lo visitan
los navegadores de tus usuarios.

## 3. Instalar

```bash
sudo mkdir -p /opt/seredina && sudo chown "$USER" /opt/seredina
git clone https://github.com/Haphior/helpdesk-seredina.git /opt/seredina
cd /opt/seredina
./scripts/setup.sh
```

`setup.sh` escribe el `.env` con secretos aleatorios. **Copiá el `.env` a un
lugar seguro, fuera de este servidor, ahora mismo** (un gestor de
contraseñas o una bóveda). Sin su `ENCRYPTION_KEY`, un backup no se puede
restaurar con los buzones, el SSO y la verificación en dos pasos de los
usuarios intactos. Ver
[lo que también necesitás respaldar](/es/despliegue/actualizaciones-y-backups#lo-que-tambien-necesitas-respaldar).

## 4. Certificado y dirección

Elegí una opción:

- **Tu empresa tiene su propia CA** (por ejemplo, Active Directory
  Certificate Services). Emití un certificado para el nombre y usalo:

  ```bash
  ./scripts/configure-address.sh --address helpdesk.tuempresa.cl --tls custom \
    --cert fullchain.pem --key key.pem --ca ca-raiz-empresa.pem
  ```

  Los navegadores de los equipos unidos al dominio ya confían en esa CA.

- **Sin CA de empresa.** Seredina genera la suya:

  ```bash
  ./scripts/configure-address.sh --address helpdesk.tuempresa.cl --tls internal
  ```

  Después instalá el certificado raíz generado en los equipos de tu
  equipo, a mano o por directiva de grupo. Ver
  [Tu dirección y HTTPS](/es/despliegue/#tu-direccion-y-https).

Let's Encrypt (`acme`) no sirve para un servidor al que internet no llega,
porque necesita llegar a los puertos 80 y 443 desde afuera.

Después levantá todo:

```bash
docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml ps
```

`configure-address.sh` deja `WEB_ORIGIN` y `API_PUBLIC_URL` en
`https://<nombre>` y `https://<nombre>/api`. Todos los enlaces que se
envían por correo, y todas las redirecciones de OAuth y SSO, salen de ahí.

Abrí `https://<nombre>`, registrá tu organización y activá la verificación
en dos pasos de las cuentas de administración (**Seguridad de la cuenta**).

## 5. Firewall

En el servidor, por ejemplo con `ufw`:

```bash
sudo ufw default deny incoming
sudo ufw allow from 10.0.0.0/8 to any port 443 proto tcp   # los rangos de tu red
sudo ufw allow from 10.0.0.0/8 to any port 80 proto tcp    # redirige a HTTPS
sudo ufw allow from <red de administración> to any port 22 proto tcp
sudo ufw enable
```

Docker publica los puertos con sus propias reglas, no con las de ufw.
Seredina deja Postgres, Redis y (con el proxy activo) los puertos de la web
y la API escuchando en `127.0.0.1`, así que hacia la red solo quedan el 80 y
el 443. Verificalo con `sudo ss -ltnp`.

Hacia afuera, el servidor necesita:

| Hacia | Para |
|---|---|
| Tus servidores de correo (IMAP 993, SMTP 587/465), o `imap.gmail.com`, `outlook.office365.com`, `login.microsoftonline.com`, `oauth2.googleapis.com` en el 443 | Canales de correo |
| La API de tu proveedor de IA, en el 443 | El copiloto de IA, salvo que uses Ollama local |
| Docker Hub, GitHub y npm, en el 443 | Compilar y actualizar |

## 6. Qué funciona en un servidor solo interno

| Función | Servidor solo interno |
|---|---|
| Consola, tickets, SLA, CMDB, escaneos de red | Sí |
| Canales de correo (IMAP/SMTP, Microsoft 365, Gmail) | Sí: el servidor se conecta hacia afuera a los buzones |
| Inicio de sesión con Microsoft Entra ID | Sí: la redirección es una dirección `https://` interna |
| Inicio de sesión con Google, buzones de Gmail | Sí, con un nombre bajo un dominio público (ver el paso 2) |
| Portal de clientes, enlaces por correo | Para quienes estén en tu red o VPN. Los enlaces apuntan al nombre interno. |
| Telegram | No: Telegram tiene que llamar al servidor desde internet |
| Webhooks de monitoreo (Zabbix, etc.) | Desde sistemas de tu red |

## 7. Agentes en tus equipos

Instalá el [agente](/es/guia/cmdb-y-activos#dispositivos) en los equipos de
la empresa. Usá **Dispositivos → Generar comando de inscripción**, elegí el
sistema operativo y ejecutá el comando como administrador. El comando lleva
la CA del servidor, así que el agente confía en tu certificado sin instalar
nada en el equipo.

- **Para muchos equipos:** cada token vale 15 minutos, para un solo equipo.
  Generá uno por equipo, o distribuí el comando desde tu herramienta de
  gestión (Intune, un script de inicio por GPO, Jamf, Ansible) en tandas
  chicas.
- **Equipos sin acceso a GitHub:** copiá los archivos de una
  [versión](https://github.com/Haphior/seredina-agent/releases) a un
  servidor web interno y configurá `AGENT_DOWNLOAD_URL`. Ver
  [Variables de entorno](/es/despliegue/variables-de-entorno).
- **Notebooks fuera de la oficina:** reportan cuando vuelven a la red o se
  conectan a la VPN. El agente reintenta cada hora.

## 8. Backups

Programá con cron el volcado nocturno de
[Actualizaciones y backups](/es/despliegue/actualizaciones-y-backups#backups)
y copiá los volcados **a otra máquina** (un NAS, un servidor de archivos,
almacenamiento de objetos). Si usás `internal`, respaldá también el volumen
`caddy_data`:

```bash
docker run --rm -v infra_caddy_data:/data -v /var/backups/seredina:/out alpine \
  tar czf /out/caddy-data-$(date +%Y%m%d).tgz -C /data .
```

El nombre es `infra_caddy_data`, salvo que hayas definido un nombre de
proyecto de compose: verificalo con `docker volume ls`. Si lo perdés, se
genera una CA nueva, y cada agente y cada navegador tiene que recibir la
nueva.

Antes de salir a producción, **restaurá un backup en una máquina de prueba**
e iniciá sesión en ella.

## 9. Actualizaciones

Seguí [Actualizar tu instancia](/es/despliegue/actualizaciones-y-backups#actualizar-tu-instancia).
Hacé un backup justo antes, y actualizá fuera del horario de trabajo.

## Lista de salida a producción

- [ ] El nombre resuelve al servidor desde los equipos de los usuarios, y el sitio carga sin aviso de certificado.
- [ ] El `.env` está copiado en un lugar seguro, fuera del servidor.
- [ ] Las cuentas de administración tienen verificación en dos pasos; el SSO funciona si lo usás.
- [ ] Un correo a cada buzón de soporte se convierte en ticket, y la respuesta le llega a quien escribió.
- [ ] Llega el correo de "olvidé mi contraseña", y su enlace abre.
- [ ] Hay un equipo Windows, uno macOS y uno Linux inscritos, y aparecen en **Activos**.
- [ ] El firewall solo expone 80/443 (y SSH para administración): verificalo con `ss -ltnp` y con un escaneo de puertos desde otra máquina.
- [ ] El backup nocturno corre, se copia fuera del servidor, y se probó una restauración.
- [ ] Alguien recibe las alertas de espacio en disco y de fallas del backup.
