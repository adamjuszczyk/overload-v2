import ts from 'typescript'

// The reader behind the rule "text on the accent is `--on-accent`" (DECISIONS 128 (g), 129 (d), 130 (j); Adam,
// 2026-10-15: "add a new token --on-accent in global.css for both themes, set to the near-black the boards draw, and
// use it wherever text sits on the accent"). It reads a source file's syntax tree and returns every style object
// that paints the accent behind something, with the colours drawn on that element, so a test can say, for the whole
// app at once, which elements put what colour on the accent (`textOnAccent.static.test.ts`).
//
// "Paints the accent" is read off the code the components write: an object with a `background` or a
// `backgroundColor` whose value holds the string `var(--accent)` (in either branch of a ternary). A tint such as
// `color-mix(in srgb, var(--accent) 15%, transparent)` is a different string and is not the accent. Comments are
// not code, so a comment that quotes the pattern is no site.
//
// The colours of a site are the `color`, `fill` and `stroke` of its own style object and, when the object is the
// `style` of a JSX element, those of every element inside it too: a button's text often sits in a child span with a
// style of its own (the week pill in Plan, the day switchers), and an icon can take its colour as an attribute.
// Colours are returned as the expression's text, whitespace squeezed (`active ? 'var(--on-accent)' : 'var(--text-muted)'`).

export interface AccentSite {
  file: string
  /** The line of the `background` property. */
  line: number
  /** The background's expression as written. */
  background: string
  /** `element`: the style of a JSX element, whose descendants' colours were read too. `object`: a style object on its own (a constant, a returned value), read as it is. */
  kind: 'element' | 'object'
  /** The colour expressions on the site: its own object's first, then its descendants'. */
  colours: string[]
}

const COLOUR_PROPERTIES = new Set(['color', 'fill', 'stroke'])
const BACKGROUND_PROPERTIES = new Set(['background', 'backgroundColor'])

const squeeze = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Whether some string in the expression is exactly `var(--accent)`: the accent itself, not a tint made from it. */
function paintsTheAccent(expression: ts.Expression): boolean {
  let found = false
  const visit = (node: ts.Node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.trim() === 'var(--accent)') found = true
    ts.forEachChild(node, visit)
  }
  visit(expression)
  return found
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(property)) return null
  const name = property.name
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null
}

/** The `color` / `fill` / `stroke` expressions of one object literal. */
function coloursOf(object: ts.ObjectLiteralExpression): string[] {
  const found: string[] = []
  for (const property of object.properties) {
    const name = propertyName(property)
    if (name !== null && COLOUR_PROPERTIES.has(name) && ts.isPropertyAssignment(property)) found.push(squeeze(property.initializer.getText()))
  }
  return found
}

/** Every colour inside an element: the style objects of it and of everything under it, and `color` / `fill` / `stroke` attributes. */
function coloursUnder(element: ts.Node): string[] {
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText()
      const value = node.initializer
      if (name === 'style' && value && ts.isJsxExpression(value) && value.expression && ts.isObjectLiteralExpression(value.expression)) {
        found.push(...coloursOf(value.expression))
      } else if (COLOUR_PROPERTIES.has(name) && value) {
        found.push(squeeze(ts.isJsxExpression(value) && value.expression ? value.expression.getText() : value.getText()))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(element)
  return found
}

/** The JSX element a `style={{ ... }}` object belongs to, as a whole (opening tag, children and closing tag). */
function elementOfStyle(object: ts.ObjectLiteralExpression): ts.Node | null {
  const expression = object.parent
  if (!ts.isJsxExpression(expression)) return null
  const attribute = expression.parent
  if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== 'style') return null
  const tag = attribute.parent.parent
  if (ts.isJsxOpeningElement(tag)) return tag.parent
  if (ts.isJsxSelfClosingElement(tag)) return tag
  return null
}

export function accentSites(source: string, file: string): AccentSite[] {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const sites: AccentSite[] = []
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const background = node.properties.find((property) => {
        const name = propertyName(property)
        return name !== null && BACKGROUND_PROPERTIES.has(name) && ts.isPropertyAssignment(property) && paintsTheAccent(property.initializer)
      })
      if (background && ts.isPropertyAssignment(background)) {
        const element = elementOfStyle(node)
        sites.push({
          file,
          line: tree.getLineAndCharacterOfPosition(background.getStart(tree)).line + 1,
          background: squeeze(background.initializer.getText()),
          kind: element ? 'element' : 'object',
          colours: element ? coloursUnder(element) : coloursOf(node),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return sites
}
