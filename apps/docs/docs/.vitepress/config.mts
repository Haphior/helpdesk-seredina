import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Seredina',
  description: 'ITSM de código abierto que te encuentra a mitad de camino.',
  lang: 'es-ES',
  base: '/helpdesk-seredina/',
  cleanUrls: true,

  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/helpdesk-seredina/favicon.svg' }]],

  themeConfig: {
    logo: '/favicon.svg',
    siteTitle: 'Seredina',

    nav: [
      { text: 'Guía de usuario', link: '/guia/' },
      { text: 'Despliegue', link: '/despliegue/' },
      { text: 'API e integraciones', link: '/api/' },
      { text: 'GitHub', link: 'https://github.com/Haphior/helpdesk-seredina' },
    ],

    sidebar: {
      '/guia/': [
        {
          text: 'Guía de usuario y agente',
          items: [
            { text: 'Primeros pasos', link: '/guia/' },
            { text: 'Tickets', link: '/guia/tickets' },
            { text: 'SLA y escalamiento', link: '/guia/sla-y-escalamiento' },
            { text: 'CMDB y activos', link: '/guia/cmdb-y-activos' },
            { text: 'Base de conocimiento', link: '/guia/base-de-conocimiento' },
            { text: 'Catálogo de servicios', link: '/guia/catalogo-de-servicios' },
            { text: 'Procesos, cambios y problemas', link: '/guia/procesos-y-plantillas' },
            { text: 'Copiloto de IA', link: '/guia/copiloto-de-ia' },
            { text: 'Canales de entrada', link: '/guia/canales' },
            { text: 'Reportes y panel', link: '/guia/reportes-y-panel' },
            { text: 'Encuestas CSAT', link: '/guia/encuestas-csat' },
            { text: 'Administración', link: '/guia/administracion' },
            { text: 'Portal público', link: '/guia/portal-publico' },
          ],
        },
      ],
      '/despliegue/': [
        {
          text: 'Despliegue y hosting',
          items: [
            { text: 'Instalación con Docker', link: '/despliegue/' },
            { text: 'Variables de entorno', link: '/despliegue/variables-de-entorno' },
            { text: 'Modo cloud (multi-tenant)', link: '/despliegue/modo-cloud' },
            { text: 'Actualizaciones y backups', link: '/despliegue/actualizaciones-y-backups' },
            { text: 'Solución de problemas', link: '/despliegue/solucion-de-problemas' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API e integraciones',
          items: [
            { text: 'Autenticación', link: '/api/' },
            { text: 'API REST', link: '/api/rest-api' },
            { text: 'Webhooks salientes', link: '/api/webhooks' },
            { text: 'Servidor MCP', link: '/api/mcp-server' },
            { text: 'Widget embebible', link: '/api/widget' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/Haphior/helpdesk-seredina' }],

    footer: {
      message: 'Publicado bajo AGPL-3.0-only.',
      copyright: 'Seredina — ITSM de código abierto que te encuentra a mitad de camino.',
    },

    search: { provider: 'local' },

    outline: { label: 'En esta página' },
    docFooter: { prev: 'Anterior', next: 'Siguiente' },
    returnToTopLabel: 'Volver arriba',
    lastUpdatedText: 'Última actualización',
  },
});
