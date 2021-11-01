/* istanbul ignore if: hard to test without actually using an unsupported version */
if (parseInt(process.version.split('.')[0].substring(1), 10) < 12) {
  console.error(
    `Node ${process.version} is not supported. Percy only supports the current LTS of Node. Please upgrade to Node v12+`
  );
  process.exit(1);
}

const { promises: fs, readdirSync, statSync } = require('fs');
const path = require('path');

// find plugins in a directory, matching a pattern, ignoring registered plugins
function findPlugins(dir, pattern, registered) {
  let segments = pattern.split('/');
  let regexp = new RegExp(`^${segments.pop().replace('*', '.*')}`);
  dir = path.join(dir, ...segments);

  return fs.readdir(dir).then(
    (f) =>
      f.reduce((plugins, dirname) => {
        // exclude CLI's own directory and any directory not matching the pattern
        if (dirname === 'cli' || !regexp.test(dirname)) return plugins;

        // If this is has a node_modules foldern with a @percy folder (ie. in pnpm), try
        // reading package.json files of children
        let directoriesToTry = [`${dir}/${dirname}`];
        const percyModulesDir = path.resolve(dir, `${dirname}/node_modules/@percy`);
        try {
          const stat = statSync(percyModulesDir);
          if (stat && stat.isDirectory()) {
            // Get top level folders
            const newDirs = readdirSync(percyModulesDir);
            directoriesToTry = newDirs
              .filter((p) => p !== 'cli')
              .map((p) => `${dir}/${dirname}/node_modules/@percy/${p}`);
            directoriesToTry.forEach(function (dx) {
              try {
                // Try to read from package.json
                let { name, oclif } = require(`${dx}/package.json`);

                // plugin's package.json have a percy oclif binary defined
                if (!registered.includes(name) && oclif && oclif.bin === 'percy') {
                  console.log(`Adding command ${name}`);
                  plugins = plugins.concat(name);
                }
              } catch {
                // ignore directories without a package.json
              }
            });
          }
        } catch {
          try {
            let { name, oclif } = require(`${dir}/${dirname}/package.json`);

            // plugin's package.json have a percy oclif binary defined
            if (!registered.includes(name) && oclif && oclif.bin === 'percy') {
              return plugins.concat(name);
            }
          } catch {
            // ignore directories without a package.json
          }
        }

        return plugins;
      }, []),
    () => []
  );
}

// automatically register/unregister plugins by altering the CLI's package.json within node_modules
async function autoRegisterPlugins() {
  let nodeModules = path.resolve(__dirname, '../..');
  let pkgPath = path.resolve(__dirname, 'package.json');
  let pkg = require(pkgPath);
  let pnpmNodeModules = path.resolve(nodeModules, '../..');

  // if not installed within node_modules, look within own node_modules
  /* istanbul ignore else: always true during tests */
  if (path.basename(nodeModules) !== 'node_modules') {
    nodeModules = path.resolve(__dirname, 'node_modules');
  }

  // ensure registered plugins can be resolved
  let registered = pkg.oclif.plugins.filter((plugin) => {
    if (pkg.dependencies[plugin]) return true;
    try {
      return !!require.resolve(plugin);
    } catch {}
    return false;
  });

  // find unregistered plugins
  let unregistered = await Promise.all([
    findPlugins(nodeModules, '@percy/*', registered),
    findPlugins(nodeModules, 'percy-cli-*', registered)
  ]).then((p) => Array.from(new Set(p.flat())));

  // if any unregistered or unresolved registered, modify plugin registry
  if (unregistered.length || registered.length !== pkg.oclif.plugins.length) {
    pkg.oclif.plugins = registered.concat(unregistered);
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
}

// auto register plugins before running oclif
module.exports.run = () => autoRegisterPlugins().then(() => require('@oclif/command').run());
