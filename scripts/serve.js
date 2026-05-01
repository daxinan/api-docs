const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');

const chokidar = require('chokidar'); 
const express = require('express');
const serveStatic = require('serve-static');

const watcher = new chokidar.FSWatcher({ignored: '*.swp'});
const glob = require('glob');

const {debounce} = require('lodash');
const open = require('open');

class Server {
  // read configuration
  constructor(parameters = {}) {
    const {
      autoOpen = false,

      watchPattern = 'docs/**/*',

      port = 8000,

      serveIndexes = ['index.html'],
      serveDir = 'docs-html',
      cacheControl = false,
      reloadPath = '/__hot_reload__'
    } = parameters;

    this.configs = {
      autoOpen,

      watchPattern,

      port,

      serveIndexes,
      serveDir,
      cacheControl,
      reloadPath,
    };

    this.buildId = Date.now().toString();
    this.configs.reloadScript = `
let currentBuildId = null;

async function pollForUpdates() {
  try {
    const response = await fetch("${this.configs.reloadPath}", {cache: "no-store"});
    const {buildId} = await response.json();

    if (currentBuildId && currentBuildId !== buildId) {
      window.location.reload();
      return;
    }

    currentBuildId = buildId;
  } catch (err) {
    console.error("hot reload polling failed", err);
  }
}

pollForUpdates();
setInterval(pollForUpdates, 1000);
`;

    this.configure();
  }

  // configure server  
  configure() {
    this.app = express();
    this.app.use(serveStatic(this.configs.serveDir, {
      index: this.configs.serveIndexes,
      cacheControl: this.configs.cacheControl,
    }));
    this.app.get(this.configs.reloadPath, this.reloadStatusHandler.bind(this));
    this.app.get('/', (req, res) => {
      res.redirect('/index.html');
    });

    this.buildDocumentation();
    this.injectReloadScript();

    watcher.on('all', debounce(this.handleSourceChange.bind(this), 500));
    watcher.add(this.configs.watchPattern);
  }

  reloadStatusHandler(req, res) {
    res.json({buildId: this.buildId});
  }

  handleSourceChange(event, path) {
    console.info(`event: ${event}, path: ${path}`);

    try {
      this.buildDocumentation();
      this.injectReloadScript();
    } catch (err) {
      console.error('failed building documentation:', err);
    }
  }

  // build documentation
  buildDocumentation() {
    console.info('building documentation');

    execSync('npm run build:docs');
    this.buildId = Date.now().toString();
  }

  injectReloadScript() {
    console.info('injecting reload script into html');

    const pattern = path.join(this.configs.serveDir, '**', '*.html');
    const paths = glob.globSync(pattern, {ignore: 'node_modules/**'}).map(p => path.join(process.cwd(), p));
  
    for (const path of paths) {
      try {
        const html = fs.readFileSync(path, 'utf8');
        const transformed = this.injectReloadScriptIntoHTML(html, this.configs.reloadScript);
        fs.writeFileSync(path, transformed, {encoding: 'utf8'});
      } catch (err) {
        process.exit(1);
      }
    }
  }

  injectReloadScriptIntoHTML(html, reloadScript) {
    const sanitizedHtml = html
      .replace(/<script>\s*const events = new EventSource\("\/events"\);[\s\S]*?<\/script>/g, '')
      .replace(/<script id="codex-hot-reload">[\s\S]*?<\/script>/g, '');
    const injectedScript = `<script id="codex-hot-reload">\n${reloadScript}\n</script>`;

    if (sanitizedHtml.includes('</head>')) {
      return sanitizedHtml.replace('</head>', `${injectedScript}</head>`);
    }

    return `${injectedScript}${sanitizedHtml}`;
  }

  // start up server
  listen() {
    this.app.listen(this.configs.port);

    console.info(`serving on: http://0.0.0.0:${this.configs.port}/index.html`);

    if (this.configs.autoOpen) {
        open(`http://0.0.0.0:${this.configs.port}/index.html`);
    }
}
}

const server = new Server();
server.listen();
