import { Router } from 'express';

/** Small browser entrypoint that points users to the JSON API examples. */
export function createHomeRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#101923">
    <title>Hotel Offer Orchestrator</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101923; color: #edf3f7; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: radial-gradient(ellipse at 80% 0%, #1b3943 0, transparent 42%), #101923; }
      main { width: min(1040px, calc(100% - 40px)); margin: 0 auto; padding: 64px 0 48px; }
      .eyebrow { color: #79d7bd; font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
      h1 { max-width: 720px; margin: 14px 0; font-size: clamp(36px, 7vw, 64px); line-height: 1.04; letter-spacing: -.045em; }
      .intro { max-width: 660px; color: #aebdc6; font-size: 17px; line-height: 1.65; }
      .status { display: inline-flex; align-items: center; gap: 9px; margin-top: 18px; padding: 9px 12px; border: 1px solid #2a4e50; border-radius: 999px; color: #bcebdc; font-size: 13px; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #66d6aa; box-shadow: 0 0 12px #66d6aa88; }
      h2 { margin: 48px 0 16px; font-size: 18px; letter-spacing: -.01em; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(245px, 1fr)); gap: 14px; }
      .card { display: block; min-height: 136px; padding: 20px; border: 1px solid #293b47; border-radius: 14px; background: #17232e; color: inherit; text-decoration: none; transition: border-color .15s ease, transform .15s ease, background .15s ease; }
      .card:hover, .card:focus-visible { transform: translateY(-2px); border-color: #5dbda7; background: #1a2a35; outline: none; }
      .method { color: #79d7bd; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px; font-weight: 700; letter-spacing: .08em; }
      .title { display: block; margin: 12px 0 7px; font-size: 16px; font-weight: 650; }
      code { color: #c5d4dc; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
      .note { margin-top: 30px; color: #899aa5; font-size: 13px; line-height: 1.6; }
      @media (max-width: 520px) { main { padding-top: 42px; } .intro { font-size: 15px; } }
      @media (prefers-reduced-motion: reduce) { .card { transition: none; } .card:hover { transform: none; } }
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">API service</div>
      <h1>Hotel Offer Orchestrator</h1>
      <p class="intro">Combines offers from two hotel suppliers, keeps the best offer for each hotel, and serves cached results with Redis price filtering.</p>
      <div class="status"><span class="dot" aria-hidden="true"></span>API is responding</div>

      <h2>Try an endpoint</h2>
      <section class="grid" aria-label="API examples">
        <a class="card" href="/health/live"><span class="method">GET</span><span class="title">Liveness</span><code>/health/live</code></a>
        <a class="card" href="/health"><span class="method">GET</span><span class="title">Dependency health</span><code>/health</code></a>
        <a class="card" href="/api/hotels?city=delhi"><span class="method">GET</span><span class="title">Delhi hotel offers</span><code>/api/hotels?city=delhi</code></a>
        <a class="card" href="/api/hotels?city=delhi&amp;minPrice=5000&amp;maxPrice=10000"><span class="method">GET</span><span class="title">Filter by price</span><code>/api/hotels?city=delhi&amp;minPrice=5000&amp;maxPrice=10000</code></a>
        <a class="card" href="/supplierA/hotels?city=delhi"><span class="method">GET</span><span class="title">Supplier A mock</span><code>/supplierA/hotels?city=delhi</code></a>
        <a class="card" href="/supplierB/hotels?city=delhi"><span class="method">GET</span><span class="title">Supplier B mock</span><code>/supplierB/hotels?city=delhi</code></a>
      </section>
      <p class="note">This page links to the JSON API examples. Supplier failure controls are documented in the README and Postman collection.</p>
    </main>
  </body>
</html>`);
  });

  return router;
}
