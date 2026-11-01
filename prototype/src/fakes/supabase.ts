// The prototype never reaches a database. Every call stays pending, so the
// real hooks keep the fixture data seeded into the query cache (demo/seed.ts):
// an unseeded read shows as loading, which is how a missing fixture shows up.
const pending = new Promise(() => {})
const chain: any = new Proxy(function () {}, {
  get: (_t, prop) => (prop === 'then' ? pending.then.bind(pending) : chain),
  apply: () => chain,
})
export const supabase = chain
