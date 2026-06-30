import { defineConfig } from 'vitepress';

// Deployed to GitHub Pages at https://valerisn.github.io/vSQL/, so the base
// path is the repo name. Change `base` if you fork under a different name.
export default defineConfig({
  base: '/vSQL/',
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
