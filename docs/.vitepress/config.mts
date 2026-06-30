import { defineConfig } from 'vitepress';

// Base path differs by host: GitHub Pages serves under /<repo>/, while a root
// domain (Cloudflare Pages, Netlify, Vercel) serves under /. Default suits
// GitHub Pages; set DOCS_BASE=/ when deploying to a root domain.
export default defineConfig({
  base: process.env.DOCS_BASE || '/vSQL/',
  title: 'vSQL',
  description: 'High-performance MySQL / MariaDB resource for FiveM',
  lastUpdated: true,
  cleanUrls: true,
  head: [['link', { rel: 'icon', href: '/vSQL/icon.svg' }]],
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Recipes', link: '/recipes' },
      { text: 'Architecture', link: '/architecture' }
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is vSQL?', link: '/' },
          { text: 'Getting started', link: '/getting-started' }
        ]
      },
      {
        text: 'Usage',
        items: [
          { text: 'Recipes', link: '/recipes' },
          { text: 'Architecture', link: '/architecture' }
        ]
      }
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/valerisn/vSQL' }],
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/valerisn/vSQL/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'github.com/valerisn/vSQL'
    }
  }
});
