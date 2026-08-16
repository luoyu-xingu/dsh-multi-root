/**
 * Standalone build config for @luoyu_xingu/dsh-multi-root.
 *
 * Two artifacts from one package:
 * - the node half (lib/index.js + lib/invariant.js): the durable roots store,
 *   the /api/dsh-multi-root route family, and the agent tools;
 * - the browser bundle (lib/client.js): a closure-factory artifact handed to
 *   the GUI's `window.__ModuleLoader__.load({ id, factory })`; externals
 *   resolve through the injected require (the shell's frozen module table —
 *   cordis DI entities, no globals, no import map). CSS Modules are compiled
 *   by lightningcss inline: importing `x.module.css` yields the hashed class
 *   map and auto-injects a `<style data-plugin>` tag at factory execution.
 *
 * The purity gate mirrors the module-edge rules of the dsh-web-ui family:
 * only platform seed modules may stay external; any other @deepseek-ai value
 * import is a build error (type-only imports are erased and never reach it).
 */
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/**
 * Plugin id, stamped into the module-loader handoff and the injected style tags.
 * The web shell's boot manifest keys every client bundle by its loader entry
 * name, so a `-live` alias deployment must build with
 * `DSH_PLUGIN_CLIENT_ID=<alias>`; a mismatch fails the GUI boot with
 * "loaded without registering".
 */
const ID = process.env.DSH_PLUGIN_CLIENT_ID ?? '@luoyu_xingu/dsh-multi-root'

/** The module specifiers the web shell shares into the frozen module table. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/** Externals resolved from the loader module table: the seed entries plus the runtime store exemption. */
const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client']

/** Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string | undefined): string {
  const emitted = importer !== undefined ? resolvePath(dirname(importer), source) : source
  const marker = `${process.platform === 'win32' ? '\\' : '/'}lib${process.platform === 'win32' ? '\\' : '/'}types${process.platform === 'win32' ? '\\' : '/'}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

/** The node-half library build (host store + routes + tools). */
const libConfig: UserConfig = {
  name: ID,
  entry: ['src/index.ts', 'src/invariant.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  // Peer-injected runtime surface: resolved from the dsh profile tree at
  // runtime, never bundled (the same stance as the dsh-web-ui family).
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-tools',
  ],
}

/** The browser-half client bundle. */
const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  // Everything NOT in the loader module table must inline (a require() the
  // table cannot answer is a guaranteed runtime throw).
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  plugins: [
    {
      // Bundle purity gate: platform seed entries stay external; every other
      // @deepseek-ai value import is a build error.
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (CLIENT_EXTERNALS.includes(source)) return null
        throw new Error(
          `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS) — `
          + 'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)',
        )
      },
    },
    {
      // CSS Modules: compile with lightningcss, emit the hashed class map, and
      // auto-inject a <style data-plugin> tag at factory execution.
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = sourceAssetPath(source, importer)
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        // The virtual id otherwise hides the physical stylesheet from the watch graph.
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        // Sort deterministically: lightningcss's iteration order is hash-seeded.
        for (const [local, exp] of Object.entries(cssExports ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
          classMap[local] = exp.name
        }
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(`${ID}/${basename(fileId)}`)};`,
          'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
          '  const tag = document.createElement(\'style\');',
          `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default (): UserConfig[] => [libConfig, clientConfig]
