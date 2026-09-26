import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Seredina',
  description: 'Open-source ITSM that meets you in the middle.',
  base: '/helpdesk-seredina/',
  cleanUrls: true,

  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/helpdesk-seredina/favicon.svg' }]],

  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        nav: [
          { text: 'User Guide', link: '/guide/' },
          { text: 'Deployment', link: '/deployment/' },
          { text: 'API & Integrations', link: '/api/' },
          { text: 'GitHub', link: 'https://github.com/Haphior/helpdesk-seredina' },
        ],
        sidebar: {
          '/guide/': [
            {
              text: 'User & Agent Guide',
              items: [
                { text: 'Getting Started', link: '/guide/' },
                { text: 'Tickets', link: '/guide/tickets' },
                { text: 'SLA & Escalation', link: '/guide/sla-and-escalation' },
                { text: 'CMDB & Assets', link: '/guide/cmdb-and-assets' },
                { text: 'Knowledge Base', link: '/guide/knowledge-base' },
                { text: 'Service Catalog', link: '/guide/service-catalog' },
                { text: 'Processes, Changes & Problems', link: '/guide/processes-and-templates' },
                { text: 'AI Copilot', link: '/guide/ai-copilot' },
                { text: 'Inbound Channels', link: '/guide/channels' },
                { text: 'Reports & Dashboard', link: '/guide/reports-and-dashboard' },
                { text: 'CSAT Surveys', link: '/guide/csat-surveys' },
                { text: 'Administration', link: '/guide/administration' },
                { text: 'Public Portal', link: '/guide/public-portal' },
                { text: 'Contacts & Personal Data', link: '/guide/contacts-and-personal-data' },
              ],
            },
          ],
          '/deployment/': [
            {
              text: 'Deployment & Hosting',
              items: [
                { text: 'Installing with Docker', link: '/deployment/' },
                { text: 'Production on a company server', link: '/deployment/internal-server' },
                { text: 'Environment Variables', link: '/deployment/environment-variables' },
                { text: 'Cloud mode (multi-tenant)', link: '/deployment/cloud-mode' },
                { text: 'Updates & Backups', link: '/deployment/updates-and-backups' },
                { text: 'Troubleshooting', link: '/deployment/troubleshooting' },
              ],
            },
          ],
          '/api/': [
            {
              text: 'API & Integrations',
              items: [
                { text: 'Authentication', link: '/api/' },
                { text: 'REST API', link: '/api/rest-api' },
                { text: 'Outbound Webhooks', link: '/api/webhooks' },
                { text: 'MCP Server', link: '/api/mcp-server' },
                { text: 'Embeddable Widget', link: '/api/widget' },
              ],
            },
          ],
        },
        footer: {
          message: 'Released under AGPL-3.0-only.',
          copyright: 'Seredina — open-source ITSM that meets you in the middle.',
        },
        outline: { label: 'On this page' },
        docFooter: { prev: 'Previous', next: 'Next' },
        returnToTopLabel: 'Return to top',
        lastUpdatedText: 'Last updated',
      },
    },
    es: {
      label: 'Español',
      lang: 'es-ES',
      link: '/es/',
      themeConfig: {
        nav: [
          { text: 'Guía de usuario', link: '/es/guia/' },
          { text: 'Despliegue', link: '/es/despliegue/' },
          { text: 'API e integraciones', link: '/es/api/' },
          { text: 'GitHub', link: 'https://github.com/Haphior/helpdesk-seredina' },
        ],
        sidebar: {
          '/es/guia/': [
            {
              text: 'Guía de usuario y agente',
              items: [
                { text: 'Primeros pasos', link: '/es/guia/' },
                { text: 'Tickets', link: '/es/guia/tickets' },
                { text: 'SLA y escalamiento', link: '/es/guia/sla-y-escalamiento' },
                { text: 'CMDB y activos', link: '/es/guia/cmdb-y-activos' },
                { text: 'Base de conocimiento', link: '/es/guia/base-de-conocimiento' },
                { text: 'Catálogo de servicios', link: '/es/guia/catalogo-de-servicios' },
                { text: 'Procesos, cambios y problemas', link: '/es/guia/procesos-y-plantillas' },
                { text: 'Copiloto de IA', link: '/es/guia/copiloto-de-ia' },
                { text: 'Canales de entrada', link: '/es/guia/canales' },
                { text: 'Reportes y panel', link: '/es/guia/reportes-y-panel' },
                { text: 'Encuestas CSAT', link: '/es/guia/encuestas-csat' },
                { text: 'Administración', link: '/es/guia/administracion' },
                { text: 'Portal público', link: '/es/guia/portal-publico' },
                { text: 'Contactos y datos personales', link: '/es/guia/contactos-y-datos-personales' },
              ],
            },
          ],
          '/es/despliegue/': [
            {
              text: 'Despliegue y hosting',
              items: [
                { text: 'Instalación con Docker', link: '/es/despliegue/' },
                { text: 'Producción en un servidor de la empresa', link: '/es/despliegue/servidor-interno' },
                { text: 'Variables de entorno', link: '/es/despliegue/variables-de-entorno' },
                { text: 'Modo cloud (multi-tenant)', link: '/es/despliegue/modo-cloud' },
                { text: 'Actualizaciones y backups', link: '/es/despliegue/actualizaciones-y-backups' },
                { text: 'Solución de problemas', link: '/es/despliegue/solucion-de-problemas' },
              ],
            },
          ],
          '/es/api/': [
            {
              text: 'API e integraciones',
              items: [
                { text: 'Autenticación', link: '/es/api/' },
                { text: 'API REST', link: '/es/api/rest-api' },
                { text: 'Webhooks salientes', link: '/es/api/webhooks' },
                { text: 'Servidor MCP', link: '/es/api/mcp-server' },
                { text: 'Widget embebible', link: '/es/api/widget' },
              ],
            },
          ],
        },
        footer: {
          message: 'Publicado bajo AGPL-3.0-only.',
          copyright: 'Seredina — ITSM de código abierto que te encuentra a mitad de camino.',
        },
        outline: { label: 'En esta página' },
        docFooter: { prev: 'Anterior', next: 'Siguiente' },
        returnToTopLabel: 'Volver arriba',
        lastUpdatedText: 'Última actualización',
      },
    },
  },

  themeConfig: {
    logo: '/favicon.svg',
    siteTitle: 'Seredina',
    socialLinks: [{ icon: 'github', link: 'https://github.com/Haphior/helpdesk-seredina' }],
    search: { provider: 'local' },
  },
});
