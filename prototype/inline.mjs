import fs from 'node:fs'
const dir = process.argv[2]
const html = fs.readFileSync(`${dir}/index.html`, 'utf8')
const css = fs.readFileSync(`${dir}/assets/${fs.readdirSync(`${dir}/assets`).find(f => f.endsWith('.css'))}`, 'utf8')
const js = fs.readFileSync(`${dir}/assets/${fs.readdirSync(`${dir}/assets`).find(f => f.endsWith('.js'))}`, 'utf8').replace(/<\/script/gi, '<\\/script')
const title = html.match(/<title>(.*?)<\/title>/)[1]
const out = `<title>${title}</title>\n<style>\n${css}\n</style>\n<div id="root"></div>\n<script type="module">\n${js}\n</script>\n`
fs.writeFileSync(process.argv[3], out)
console.log('wrote', out.length)
