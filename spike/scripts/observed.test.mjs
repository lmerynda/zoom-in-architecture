import { describe, expect, it } from 'vitest'
import { callsInto, classFiles, declaredTypes, markObserved, tableVerbs } from './observed.mjs'

const file = (id, path, parent = 'app') => ({ id, parent, title: id, kind: 'code', metadata: { path } })

const java = (pkg, body) => `${pkg ? `package ${pkg};\n\n` : ''}import java.util.List;\n\n${body}\n`

describe('declaredTypes', () => {
  it('lists the types each Java file declares, by package: package-private ones, interfaces and member types too, local and anonymous ones not', () => {
    const types = declaredTypes({
      'src/shop/Offer.java': java('shop', '/** An offer. class NotThis {} */\n@Entity(name = "class Nope {")\n@Import({ Foo.class, Bar.class })\npublic class Offer {\n  static class Builder { class Step { } }\n  interface Step { }\n  Runnable r = new Runnable() { public void run() { } };\n  static { }\n  void make() { class Local { } if (true) { } }\n}\n\nclass OfferHelper implements Comparable<OfferHelper> { }\nrecord Price(@Min({ 0 }) int cents) { Price { } }\nsealed interface Shape permits Price { }'),
      'src/shop/OfferRepository.java': java('shop', 'public interface OfferRepository extends JpaRepository<Offer, Long> { }'),
      'src/Main.java': java('', 'public final class Main { public static void main(String[] a) { new Object() { }; } }'),
      'src/läden/Größe.java': java('läden', 'public enum Größe { KLEIN { void x() { } }, GROSS }\n@interface Maß { }'),
    })
    expect(types).toEqual(new Map([
      // A member type under its binary name, as the agent names it, and its name in the source.
      ['shop.Offer', ['src/shop/Offer.java']], ['shop.Offer$Builder', ['src/shop/Offer.java']], ['shop.Offer.Builder', ['src/shop/Offer.java']],
      ['shop.Offer$Builder$Step', ['src/shop/Offer.java']], ['shop.Offer.Builder.Step', ['src/shop/Offer.java']], ['shop.Offer$Step', ['src/shop/Offer.java']], ['shop.Offer.Step', ['src/shop/Offer.java']],
      ['shop.OfferHelper', ['src/shop/Offer.java']], ['shop.Price', ['src/shop/Offer.java']], ['shop.Shape', ['src/shop/Offer.java']],
      ['shop.OfferRepository', ['src/shop/OfferRepository.java']], ['Main', ['src/Main.java']],
      ['läden.Größe', ['src/läden/Größe.java']], ['läden.Maß', ['src/läden/Größe.java']],
    ]))
  })

  it('reads a declaration as the compiler does: a long record, a package split by a comment, Unicode escapes, a text block ending in backslashes', () => {
    const fields = Array.from({ length: 60 }, (_, k) => `long component${k}`).join(', ')
    const types = declaredTypes({
      'src/shop/Invoice.java': java('shop', `public record Invoice(${fields}) { }`),
      'src/shop/sales/Order.java': 'package shop /* the shop */ . sales;\n\nclass Order { }\n',
      'src/shop/Ord.java': 'package shop;\nclass Ord\\u0065r { }\n\\u002f\\u002f class Phantom { }\n',
      'src/shop/Text.java': 'package shop;\nclass Text { String s = """\n  ends in a backslash \\\\""";\n}\n// """ class Ghost { }\n',
    })
    expect([...types.keys()].sort()).toEqual(['shop.Invoice', 'shop.Order', 'shop.Text', 'shop.sales.Order'])
  })

  it('reads whole identifiers: "class" ending a name is no keyword, and a combining mark is part of a name', () => {
    const types = declaredTypes({
      'src/p/A.java': java('p', 'class A { X$class all() { return null; } }\nclass X$class { }'),
      'src/p/Café.java': java('p', 'class Cafe\\u0301 { }'),
    })
    expect([...types.keys()].sort()).toEqual(['p.A', 'p.Café', 'p.X$class'])
  })

  it('reads an escaped line break as one, and leaves out what Java ignores in a name', () => {
    const types = declaredTypes({
      'src/p/Handlers.java': java('p', '// header\\u000a class Outer$Handler { }'),
      'src/p/Cafe.java': java('p', 'class Ca​fe { }'),
    })
    expect([...types.keys()].sort()).toEqual(['p.Cafe', 'p.Outer$Handler'])
  })

  it('cuts a binary name only at an anonymous, local or generated class, and places none a named class elsewhere could be', () => {
    const types = declaredTypes({
      'a/p/Price.java': java('p', 'class Price { }'),
      'a/p/Outer.java': java('p', 'class Outer { }'), 'b/p/Outer$1.java': java('p', 'class Outer$1 { }'),
    })
    // A dependency's Price$Codec is no member Price.java declares; Outer$1 may be a's anonymous class or b's class of that name.
    expect(classFiles(types, ['p.Price$Codec', 'p.Price$1', 'p.Price$1Local', 'p.Price$$Lambda/0x01', 'p.Outer$1', 'p.Outer$2'])).toEqual(new Map([
      ['p.Price$1', 'a/p/Price.java'], ['p.Price$1Local', 'a/p/Price.java'], ['p.Price$$Lambda/0x01', 'a/p/Price.java'], ['p.Outer$2', 'a/p/Outer.java'],
    ]))
  })

  it('lists a member type under its binary name too, so a top-level class of that name elsewhere makes it ambiguous', () => {
    const types = declaredTypes({ 'a/p/Outer.java': java('p', 'class Outer { class Inner { } }'), 'b/p/Outer$Inner.java': java('p', 'class Outer$Inner { }') })
    expect(types).toEqual(new Map([['p.Outer', ['a/p/Outer.java']], ['p.Outer$Inner', ['a/p/Outer.java', 'b/p/Outer$Inner.java']], ['p.Outer.Inner', ['a/p/Outer.java']]]))
    expect(classFiles(types, ['p.Outer$Inner', 'p.Outer.Inner'])).toEqual(new Map([['p.Outer.Inner', 'a/p/Outer.java']]))
    // With only the outer class in another module, the member's binary name is the one module's that declares it.
    const split = declaredTypes({ 'a/p/Outer.java': java('p', 'class Outer { class Inner { } }'), 'b/p/Other.java': java('p', 'class Other { }') })
    expect(classFiles(split, ['p.Outer$Inner', 'p.Outer$Inner$1'])).toEqual(new Map([['p.Outer$Inner', 'a/p/Outer.java'], ['p.Outer$Inner$1', 'a/p/Outer.java']]))
  })

  it('keeps every file one name is declared in, reads only Java, and lists nothing from nothing', () => {
    expect(declaredTypes({ 'a/src/shop/Cart.java': java('shop', 'class Cart {}'), 'b/src/shop/Cart.java': java('shop', 'class Cart {}') }))
      .toEqual(new Map([['shop.Cart', ['a/src/shop/Cart.java', 'b/src/shop/Cart.java']]]))
    // A polyglot model's other files have their own Order: the Java agent's spans never name them.
    expect(declaredTypes({ 'py/shop/Order.py': 'class Order:\n  pass\n', 'cs/shop/Order.cs': 'namespace shop { public class Order { } }', 'go/shop/order.go': 'package shop\ntype Order struct{}\n' })).toEqual(new Map())
    expect(declaredTypes({})).toEqual(new Map())
    expect(declaredTypes({ 'src/Empty.java': '' })).toEqual(new Map())
  })
})

describe('classFiles', () => {
  const types = declaredTypes({
    'src/shop/MarketController.java': java('shop', 'public class MarketController { }'),
    'src/shop/MarketControllerTest.java': java('shop', 'class MarketControllerTest { }'),
    'src/shop/Offer.java': java('shop', 'public class Offer { static class Builder { class Step { } } }\nclass OfferHelper { }'),
    'src/shop/Cash$Box.java': java('shop', 'class Cash$Box { }'),
    'src/shop/Cash.java': java('shop', 'class Cash { }'),
    'src/market/Offer.java': java('market', 'public class Offer { }'),
    'a/src/shop/Cart.java': java('shop', 'class Cart { }'), 'b/src/shop/Cart.java': java('shop', 'class Cart { }'),
    'src/shop/Main.java': java('shop', 'class Main { }'),
    'src/shop/付款.java': java('shop', 'class 付款 { static class Inner { } }'),
    'src/läden/Größe.java': java('läden', 'class Größe { enum Maß { A } }'),
    'src/acme/API.java': java('acme', 'class API { }'),
  })

  it('finds a class’s file by its package and name, two top-level classes of one file both, and never a longer or shorter name', () => {
    expect(classFiles(types, ['shop.MarketController', 'shop.Offer', 'shop.OfferHelper', 'market.Offer', 'other.Missing', 'shop.Market'])).toEqual(new Map([
      ['shop.MarketController', 'src/shop/MarketController.java'], ['shop.Offer', 'src/shop/Offer.java'], ['shop.OfferHelper', 'src/shop/Offer.java'], ['market.Offer', 'src/market/Offer.java'],
    ]))
  })

  it('places inner, anonymous, lambda and proxy classes ($) in their top-level class’s file, unless a top-level class has that very name', () => {
    expect(classFiles(types, ['shop.Offer$Builder', 'shop.Offer$1', 'shop.Offer$Builder$Step', 'shop.Offer$$Lambda/0x01', 'shop.Offer$$SpringCGLIB$$0', 'shop.Cash$Box', 'shop.Cash$1'])).toEqual(new Map([
      ['shop.Offer$Builder', 'src/shop/Offer.java'], ['shop.Offer$1', 'src/shop/Offer.java'], ['shop.Offer$Builder$Step', 'src/shop/Offer.java'],
      ['shop.Offer$$Lambda/0x01', 'src/shop/Offer.java'], ['shop.Offer$$SpringCGLIB$$0', 'src/shop/Offer.java'],
      ['shop.Cash$Box', 'src/shop/Cash$Box.java'], ['shop.Cash$1', 'src/shop/Cash.java'],
    ]))
  })

  it('places a nested class written with a dot in the file that declares it, in any script, and a class of a package named like a class nowhere', () => {
    expect(classFiles(types, ['shop.Offer.Builder', 'shop.Offer.Builder.Step', 'shop.付款.Inner', 'läden.Größe.Maß', 'läden.Größe$Maß', 'shop.Missing.Inner', 'shop.Offer.Missing'])).toEqual(new Map([
      ['shop.Offer.Builder', 'src/shop/Offer.java'], ['shop.Offer.Builder.Step', 'src/shop/Offer.java'],
      ['shop.付款.Inner', 'src/shop/付款.java'], ['läden.Größe.Maß', 'src/läden/Größe.java'], ['läden.Größe$Maß', 'src/läden/Größe.java'],
    ]))
    // A library's acme.API.Client (package acme.API) is not a class of acme/API.java; nor is a class of a package with a "$" in its name.
    expect(classFiles(types, ['acme.API.Client', 'shop.Cash$external.Client', 'acme.API$1'])).toEqual(new Map([['acme.API$1', 'src/acme/API.java']]))
  })

  it('places no class in a package it is not in, and none that two files declare', () => {
    // Main in no package is not shop.Main; shop.Cart is in two modules: which ran is not known.
    expect(classFiles(types, ['Main', 'Offer', 'shop.Cart', 'shop.Cart$1'])).toEqual(new Map())
  })

  it('places nothing from nothing', () => {
    expect(classFiles(new Map(), ['shop.MarketController'])).toEqual(new Map())
    expect(classFiles(types, [])).toEqual(new Map())
    expect(classFiles(types, ['', '$Proxy42', 'com.sun.proxy.$Proxy42'])).toEqual(new Map())
  })
})

describe('callsInto', () => {
  const fileOf = classFiles(declaredTypes({
    'src/shop/MarketController.java': java('shop', 'public class MarketController { }'),
    'src/shop/OfferRepository.java': java('shop', 'public interface OfferRepository { }'),
    // Two top-level classes in one file.
    'src/shop/Offer.java': java('shop', 'public class Offer { static class Builder { } }\nclass OfferHelper { }'),
  }), ['shop.MarketController', 'shop.Offer', 'shop.Offer$Builder', 'shop.OfferHelper', 'shop.OfferRepository', 'lib.Proxy'])

  it('counts a call into a file once: a span under one of that file’s own is the same call or a call inside it', () => {
    // Three requests: the agent's controller span over the method's own span (both MarketController), which calls the repository twice.
    const codeCalls = { 'shop.MarketController': { '': 3, 'shop.MarketController': 3 }, 'shop.OfferRepository': { 'shop.MarketController': 6 } }
    expect(callsInto(codeCalls, fileOf)).toEqual(new Map([['src/shop/MarketController.java', 3], ['src/shop/OfferRepository.java', 6]]))
  })

  it('adds up a file’s classes called from outside it, and never counts its classes calling each other', () => {
    const codeCalls = {
      'shop.Offer': { 'shop.MarketController': 4, 'shop.Offer$Builder': 9, 'shop.OfferHelper': 3 },
      'shop.Offer$Builder': { 'shop.MarketController': 2, 'shop.Offer': 5 },
      'shop.OfferHelper': { 'shop.Offer': 7, 'lib.Proxy': 1, 'lib.Unplaced': 1 },
    }
    expect(callsInto(codeCalls, fileOf)).toEqual(new Map([['src/shop/Offer.java', 8]]))
  })

  it('counts nothing for no calls, and nothing for classes no file is', () => {
    expect(callsInto({}, fileOf)).toEqual(new Map())
    expect(callsInto({ 'lib.Proxy': { '': 5 }, 'other.Thing': { 'shop.Offer': 1 } }, fileOf)).toEqual(new Map())
  })
})

describe('markObserved', () => {
  // As trace.mjs sums them: each class's spans by the class whose span they ran under ('' none: the request itself).
  // The controller's spans are two per request that reached it (the agent's controller span and the method's own).
  const observed = {
    endpoints: [
      { method: 'POST', route: '/market/{id}/buy', count: 3, statuses: { 200: 2, 401: 1 }, tables: { offers: ['SELECT', 'UPDATE'] }, codeCalls: { 'shop.MarketController': { '': 3, 'shop.MarketController': 3 }, 'shop.OfferRepository': { 'shop.MarketController': 2 } }, calls: {} },
      { method: 'POST', route: '/market/create', count: 1, statuses: { 200: 1 }, tables: { offers: ['INSERT'] }, codeCalls: {}, calls: {} },
    ],
    background: {},
  }
  // What the model's Java files declare (declaredTypes): Offer.java holds Offer's nested classes too.
  const types = declaredTypes({
    'src/shop/MarketController.java': java('shop', 'public class MarketController { }'),
    'src/shop/OfferRepository.java': java('shop', 'public interface OfferRepository { }'),
    'src/shop/MarketService.java': java('shop', 'public class MarketService { }'),
    'src/shop/Offer.java': java('shop', 'public class Offer { static class Builder { } record Price(int c) { } }'),
  })
  const build = () => ({
    model: {
      elements: [{ id: 'app', parent: null, title: 'App', kind: 'app' }, { id: 'db', parent: null, title: 'DB', kind: 'database' }, file('app.ctl', 'src/shop/MarketController.java'), file('app.repo', 'src/shop/OfferRepository.java'), file('app.svc', 'src/shop/MarketService.java')],
      relations: [{ source: 'app.repo', target: 'db', title: 'offers (JPA)', kind: 'runtime' }, { source: 'app.svc', target: 'app.repo', title: 'save', kind: 'code' }],
    },
    requests: {
      elements: [
        { id: 'app', parent: null, title: 'App', kind: 'app', metadata: {} }, { id: 'db', parent: null, title: 'DB', kind: 'database', metadata: {} },
        { id: 'app.e1', parent: 'app', title: 'POST /market/{id}/buy', kind: 'component', metadata: { method: 'POST', route: '/market/{id}/buy' } },
        { id: 'app.e1.s1', parent: 'app.e1', title: '1 · buy()', metadata: { role: 'step', step: '1', path: 'src/shop/MarketController.java' } },
        { id: 'app.e1.s2', parent: 'app.e1', title: '2 · MarketService', metadata: { role: 'step', step: '2', path: 'src/shop/MarketService.java' } },
        { id: 'app.e1.s3', parent: 'app.e1', title: '3 · OfferRepository', metadata: { role: 'step', step: '3', path: 'src/shop/OfferRepository.java' } },
        { id: 'app.e2', parent: 'app', title: 'POST /market/create', kind: 'component', metadata: { method: 'POST', route: '/market/create' } },
        { id: 'app.e2.s1', parent: 'app.e2', title: '1 · create()', metadata: { role: 'step', step: '1', path: 'src/shop/MarketController.java' } },
        { id: 'app.e3', parent: 'app', title: 'GET /market/:id', kind: 'component', metadata: { method: 'GET', route: '/market/:id' } },
      ],
      relations: [{ source: 'app.e1.s3', target: 'db', title: 'offers (JPA)' }],
    },
  })

  it('marks endpoints seen or not, with statuses and tables, and gives coverage per app', () => {
    const { model, requests } = build()
    expect(markObserved(model, requests, observed, types)).toEqual({ seen: 2, total: 3 })
    const at = id => requests.elements.find(e => e.id === id).metadata
    expect(at('app.e1')).toMatchObject({ seen: '3', statuses: '200 ×2 · 401 ×1', tables: 'offers: SELECT, UPDATE' })
    // An endpoint no test called says so; its route written :id still matches the observed {id} form.
    expect(at('app.e3').seen).toBe('0')
    expect(at('app').seen).toBe('2/3')
  })

  it('marks the steps whose classes ran with their own counts, and leaves the others unclaimed rather than unseen', () => {
    const { model, requests } = build()
    markObserved(model, requests, observed, types)
    const at = id => requests.elements.find(e => e.id === id).metadata.seen
    // The repository ran twice in three requests (one stopped at 401): its count is its own.
    expect([at('app.e1.s1'), at('app.e1.s2'), at('app.e1.s3')]).toEqual(['3', undefined, '2'])
  })

  it('marks a store link seen by its endpoint’s requests, with the tables they touched, and adds one a request needed but the code reading missed', () => {
    const { model, requests } = build()
    markObserved(model, requests, observed, types)
    // The count is the endpoint's requests, said so, never calls across the link itself.
    expect(requests.relations[0]).toMatchObject({ seen: 3, seenOf: 'requests', tables: 'updates and reads offers' })
    // The added link says the map has none: the trace added it.
    expect(requests.relations[1]).toEqual({ source: 'app.e2.s1', target: 'db', title: 'inserts offers', kind: 'runtime', seen: 1, seenOf: 'requests', tables: 'inserts offers', origin: 'trace' })
  })

  it('gives no store tables it cannot place: with two databases, a mapped link keeps its count but no tables, and none is added', () => {
    const { model, requests } = build()
    requests.elements.push({ id: 'cache', parent: null, title: 'Cache', kind: 'database', metadata: {} })
    markObserved(model, requests, observed, types)
    expect(requests.relations).toHaveLength(1)
    expect(requests.relations[0]).toMatchObject({ seen: 3, seenOf: 'requests' })
    expect(requests.relations[0].tables).toBeUndefined()
    // The endpoint still says what its requests did to which tables.
    expect(requests.elements.find(e => e.id === 'app.e2').metadata.tables).toBe('offers: INSERT')
  })

  it('says what each table had done to it, writes first, never one verb for all', () => {
    expect(tableVerbs({ user_entity: ['SELECT'], market_offer_entity: ['SELECT', 'DELETE'], kingdom_entity: ['UPDATE', 'SELECT'] }))
      .toBe('updates and reads kingdom_entity · deletes and reads market_offer_entity · reads user_entity')
    expect(tableVerbs({ ü_tabelle: ['MERGE'] })).toBe('writes ü_tabelle')
    expect(tableVerbs({})).toBe('')
  })

  it('marks the architecture: files that ran, their runtime links, and the tables of the one store reached', () => {
    const { model, requests } = build()
    markObserved(model, requests, observed, types)
    const at = id => model.elements.find(e => e.id === id).metadata
    expect([at('app.ctl').seen, at('app.repo').seen, at('app.svc').seen]).toEqual(['3', '2', undefined])
    expect(model.relations.map(r => r.seen)).toEqual([2, undefined])
    // In the architecture a runtime link's count is the calls into its source file's code.
    expect(model.relations.map(r => r.seenOf)).toEqual(['code', undefined])
    expect(at('db').tables).toBe('offers: INSERT, SELECT, UPDATE')
  })

  it('counts calls into a file, in the architecture and in a request: its classes called from outside it added up, never once per span or per class inside it', () => {
    const { model, requests } = build()
    model.elements.push(file('app.offer', 'src/shop/Offer.java'))
    requests.elements.push({ id: 'app.e1.s4', parent: 'app.e1', title: '4 · Offer', metadata: { role: 'step', step: '4', path: 'src/shop/Offer.java' } })
    const buy = { ...observed.endpoints[0], codeCalls: { ...observed.endpoints[0].codeCalls, 'shop.Offer': { 'shop.MarketController': 2 }, 'shop.Offer$Builder': { 'shop.MarketController': 1, 'shop.Offer': 4 }, 'shop.Offer.Price': { 'shop.Offer$Builder': 6 } } }
    const list = { method: 'GET', route: '/market/:id', count: 1, statuses: { 200: 1 }, tables: {}, codeCalls: { 'shop.Offer$1': { '': 1 } }, calls: {} }
    markObserved(model, requests, { endpoints: [buy, observed.endpoints[1], list], background: {} }, types)
    expect(model.elements.find(e => e.id === 'app.offer').metadata.seen).toBe('4')
    expect(model.elements.find(e => e.id === 'app.ctl').metadata.seen).toBe('3')
    // In the request, only that endpoint's calls.
    expect(requests.elements.find(e => e.id === 'app.e1.s4').metadata.seen).toBe('3')
  })

  it('refuses a trace summed before calls into code were counted by caller: it says to trace again', () => {
    const { model, requests } = build()
    const old = { endpoints: [{ method: 'POST', route: '/market/create', count: 1, statuses: {}, tables: {}, code: { 'shop.MarketController.create': 1 }, calls: {} }], background: {} }
    expect(() => markObserved(model, requests, old, types)).toThrow(/zoom trace again/)
  })

  it('works with no Requests view and no observations', () => {
    const { model } = build()
    expect(markObserved(model, null, { endpoints: [], background: {} }, new Map())).toEqual({ seen: 0, total: 0 })
    expect(model.elements.every(e => e.metadata?.seen === undefined)).toBe(true)
  })
})
