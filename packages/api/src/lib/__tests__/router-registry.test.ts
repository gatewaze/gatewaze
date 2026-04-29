import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import {
  labeledRouter,
  mountLabeled,
  labelDirectRoute,
  assertAllRoutesLabeled,
  getRegistry,
  clearRegistry,
} from '../router-registry.js';

describe('router-registry', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('records routes registered via labeledRouter+mountLabeled with the full path', () => {
    const app = express();
    const r = labeledRouter('jwt');
    r.get('/foo', (_req, res) => res.json({}));
    r.post('/bar', (_req, res) => res.json({}));
    mountLabeled(app, '/api/things', r);

    const recorded = getRegistry();
    expect(recorded.map(x => `${x.method} ${x.path} ${x.label}`).sort()).toEqual([
      'GET /api/things/foo jwt',
      'POST /api/things/bar jwt',
    ]);
  });

  it('records distinct labels per router', () => {
    const app = express();
    const jwt = labeledRouter('jwt');
    jwt.get('/private', (_req, res) => res.json({}));
    mountLabeled(app, '/api/private', jwt);

    const pub = labeledRouter('public');
    pub.get('/health', (_req, res) => res.json({}));
    mountLabeled(app, '/api', pub);

    const recorded = getRegistry();
    expect(recorded.find(r => r.path === '/api/private/private')?.label).toBe('jwt');
    expect(recorded.find(r => r.path === '/api/health')?.label).toBe('public');
  });

  it('assertAllRoutesLabeled passes when every route is labeled', () => {
    const app = express();
    const r = labeledRouter('public');
    r.get('/', (_req, res) => res.json({}));
    mountLabeled(app, '/api/health', r);

    expect(() => assertAllRoutesLabeled(app)).not.toThrow();
  });

  it('assertAllRoutesLabeled throws when a route bypasses labeledRouter', () => {
    const app = express();
    app.get('/sneaky', (_req, res) => res.json({}));

    expect(() => assertAllRoutesLabeled(app)).toThrow(/lacking auth label/);
  });

  it('labelDirectRoute lets us register direct app.get() routes', () => {
    const app = express();
    app.get('/metrics', (_req, res) => res.send('# HELP'));
    labelDirectRoute('GET', '/metrics', 'public');

    expect(() => assertAllRoutesLabeled(app)).not.toThrow();
  });

  it('mountLabeled refuses non-labeled routers', () => {
    const app = express();
    const r = express.Router();
    expect(() => mountLabeled(app, '/api', r)).toThrow(/not created via labeledRouter/);
  });
});
