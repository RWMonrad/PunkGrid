// UI03 disables "Create" and says why. The server stays the authority (§11 has no
// template route), so this catalogue is only allowed to be a *pre*-check: these
// tests pin the cases where it agrees with the rulepack's own constraints.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CATALOGS, GLASS_HARBOR, catalogFor, checkSetting, labelFor } from './setting';

const valid = { era: '2034', location: 'singapore', role: 'founder-ceo' };

describe('checkSetting', () => {
  it('accepts the shipped opening setting', () => {
    expect(checkSetting(GLASS_HARBOR, valid)).toEqual([]);
  });

  it('names every bounded value the catalogue does not carry', () => {
    const problems = checkSetting(GLASS_HARBOR, { era: '1999', location: 'atlantis', role: 'janitor' });
    expect(problems).toHaveLength(3);
    expect(problems.join(' ')).toContain('atlantis');
    expect(problems.join(' ')).toContain('1999');
    expect(problems.join(' ')).toContain('janitor');
  });

  it('requires alternate history for a setting the ordinary world cannot reach', () => {
    expect(checkSetting(GLASS_HARBOR, { ...valid, location: 'mars' })).toEqual([
      'A Mars setting needs the alternate-history flag: ordinary institutional limits do not carry you there.',
    ]);
    expect(checkSetting(GLASS_HARBOR, { ...valid, location: 'mars', flags: ['alternate_history'] })).toEqual([]);
  });

  it('reports the stricter constraint when both apply, without dropping the first', () => {
    const problems = checkSetting(GLASS_HARBOR, { era: '1888', location: 'mars', role: 'investigator' });
    expect(problems).toHaveLength(2);
    expect(problems[1]).toBe('1888 Mars travel is not supported without alternate history.');
  });

  it('leaves a supported combination alone', () => {
    expect(checkSetting(GLASS_HARBOR, { era: '1888', location: 'copenhagen', role: 'investigator' })).toEqual([]);
  });
});

describe('the shipped catalogue', () => {
  it('is the one template the genesis screen can offer', () => {
    expect(CATALOGS.map((c) => c.id)).toEqual(['glass-harbor-2034']);
    expect(catalogFor('glass-harbor-2034')?.version).toBe('1.0');
    expect(catalogFor('no-such-template')).toBeUndefined();
  });

  it('has a display label for every bounded value it sends', () => {
    expect(labelFor(GLASS_HARBOR, 'location', 'singapore')).toBe('Singapore');
    expect(labelFor(GLASS_HARBOR, 'era', '1888')).toBe('1888');
    expect(labelFor(GLASS_HARBOR, 'role', 'operations-director')).toBe('Operations director');
    expect(labelFor(GLASS_HARBOR, 'role', 'ghost')).toBe('ghost');
  });

  it('keeps the constraint ids stable, since the server echoes them in a rejection', () => {
    expect(GLASS_HARBOR.constraints.map((c) => c.id)).toEqual(['mars-needs-alternate-history', 'victorian-mars-impossible']);
  });

  // §11 has no cast route: the engine writes names into prose and choice copy, and the
  // client has to know who is in the room to show a face beside a word. That makes this
  // catalogue a *copy* of the rulepack, and a copy is allowed to drift — so the two
  // directions of drift are both closed here, against the rulepack source as it stands
  // on disk rather than a list someone can edit into agreement.
  it('names exactly the cast the rulepack has, with the same one marked as you', () => {
    const rulepack = readFileSync(new URL('../../../../core/src/glassHarbor.ts', import.meta.url), 'utf8');
    const characters = [...rulepack.matchAll(/\{ id: '(char_\w+)', name: '([^']+)', isPlayer: (true|false)/g)];
    expect(characters.length).toBeGreaterThan(0);
    expect(GLASS_HARBOR.cast).toHaveLength(characters.length);
    for (const [, id, name, isPlayer] of characters) {
      const entry = GLASS_HARBOR.cast.find((p) => p.name === name);
      expect(entry, `the rulepack has ${name} (${id}) but the app does not show them`).toBeDefined();
      expect(Boolean(entry?.you), `${name} is isPlayer:${isPlayer}`).toBe(isPlayer === 'true');
    }
    for (const p of GLASS_HARBOR.cast) {
      expect(rulepack.includes(`name: '${p.name}'`), `the app shows ${p.name}, who the rulepack does not have`).toBe(true);
    }
  });

  // ArtPlate renders nothing for a name with no file, which is the safe direction — but
  // a cast that silently lost a face is not a cast, and it is invisible to the device
  // walk because there is no picture in the tree to measure.
  it('has a portrait file for every name it ships', () => {
    for (const p of GLASS_HARBOR.cast) {
      const file = new URL(`../../assets/img/cast-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`, import.meta.url);
      expect(existsSync(file), `${p.name} has no portrait at ${file.pathname}`).toBe(true);
    }
  });
});
