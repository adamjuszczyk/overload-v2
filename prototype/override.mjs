// Copies a real screen from the repo into src/overrides/, pointing its relative
// imports back at the repo (@app/...), so the copy can be changed for 1.2.1
// while everything it uses stays the real code.
import fs from 'node:fs'
import path from 'node:path'
const REPO = fs.realpathSync(process.env.PROTOTYPE_APP_SRC ?? new URL('../src', import.meta.url).pathname)
for (const rel of process.argv.slice(2)) {
  const src = path.join(REPO, rel)
  const dir = path.dirname(rel)
  const text = fs.readFileSync(src, 'utf8').replace(/from '(\.\.?\/[^']+)'/g, (_m, p) => `from '@app/${path.posix.normalize(path.posix.join(dir, p))}'`)
  const out = path.join('src/overrides', path.basename(rel))
  fs.writeFileSync(out, text)
  console.log('override', rel, '->', out)
}
