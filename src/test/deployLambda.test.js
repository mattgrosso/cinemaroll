import { describe, it, expect } from 'vitest';
import { LAMBDAS, localRequires, reachableFiles } from '../../scripts/deploy-lambda.mjs';

// `yarn deploy:push` / `deploy:ai` / `deploy:newsletter` copy a fixed list of sources over the
// deployed zip. A module the code requires but the list leaves out ships a
// Lambda that dies on its first load — the script refuses that at deploy
// time, and this catches it at commit time.

describe('deploy-lambda', () => {
  it('reads ./ requires, with or without the .js', () => {
    const source = "const a = require('./pushCadence');\nconst b = require('./sentryLambda.js');\nconst c = require('web-push');";
    expect(localRequires(source)).toEqual(['aws-lambda/pushCadence.js', 'aws-lambda/sentryLambda.js']);
  });

  it('follows requires through the files they reach', () => {
    const tree = {
      'aws-lambda/a.js': "require('./b')",
      'aws-lambda/b.js': "require('./c.js'); require('./a')",
      'aws-lambda/c.js': ''
    };
    expect(reachableFiles('aws-lambda/a.js', (path) => tree[path]).sort())
      .toEqual(['aws-lambda/a.js', 'aws-lambda/b.js', 'aws-lambda/c.js']);
  });

  for (const [name, lambda] of Object.entries(LAMBDAS)) {
    it(`bundles everything ${lambda.entry} reaches (${name})`, () => {
      expect(reachableFiles(lambda.entry).filter((file) => !lambda.files[file])).toEqual([]);
    });
  }

  it('ships push-notify.js as index.js, the handler the push Lambda is set to', () => {
    expect(LAMBDAS.push.files['aws-lambda/push-notify.js']).toBe('index.js');
  });

  it('ships newsletter.js as index.js, with the 2 MB floor that caught a hollow bundle', () => {
    expect(LAMBDAS.newsletter.files['aws-lambda/newsletter.js']).toBe('index.js');
    expect(LAMBDAS.newsletter.minBytes).toBeGreaterThanOrEqual(2000000);
  });
});
