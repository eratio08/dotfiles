return {
  filetypes = {
    'heex', 'aspnetcorerazor', 'astro', 'astro-markdown', 'blade', 'clojure', 'django-html', 'htmldjango', 'edge',
    'eelixir', 'elixir', 'ejs', 'erb', 'eruby', 'gohtml', 'gohtmltmpl', 'haml', 'handlebars', 'hbs', 'html',
    'htmlangular', 'html-eex', 'heex', 'jade', 'leaf', 'liquid', 'markdown', 'mdx', 'mustache', 'njk', 'nunjucks',
    'php', 'razor', 'slim', 'twig', 'css', 'less', 'postcss', 'sass', 'scss', 'stylus', 'sugarss', 'javascript',
    'javascriptreact', 'reason', 'rescript', 'typescript', 'typescriptreact', 'vue', 'svelte', 'templ', 'gleam'
  },
  settings = {
    tailwindCSS = {
      validate = true,
      classAttributes = { 'class', 'className', 'class:list', 'classList', 'ngClass' },
      classFunctions = { 'class', 'attribute\\.class' },
      includeLanguages = {
        gleam = 'html'
      },
      experimental = {
        classRegex = {
          { [[class\(([^)]*)\)]], [[\s*"([^"]*)]] },
          { [[attribute\.class\(([^)]*)\)]], [[\s*"([^"]*)]] }
        },
      },
    },
  },
}
