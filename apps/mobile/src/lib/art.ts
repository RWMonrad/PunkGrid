// The art contract — see docs/design/ART.md for the file names, sizes and prompts.
//
// Metro only bundles a `require` whose path is a literal in this file, so every
// piece of art the app can show has to be named here. That is also the rule that
// keeps art honest: a world renders the picture its rulepack actually ships, and
// a rulepack without a picture renders the text-only layout instead.

import type { ImageSourcePropType } from 'react-native';

/** UI01: the seam on the welcome screen. */
export const welcomePortal = require('../../assets/img/welcome-portal.jpg') as ImageSourcePropType;

/** UI01: the mark beside the wordmark — the delivered brand glyph (`docs/design/
 *  brand/punkgrid-logo.png`), cropped to the cube and its ring. The lockup itself is
 *  not used here: at 48 dp its wordmark is mush, and UI01 already spells the name. */
export const welcomeEmblem = require('../../assets/img/welcome-emblem.png') as ImageSourcePropType;

/** UI02: the two doors, each painted as the kind of door it is. The seam above them is
 *  `welcomePortal` — the same harbour, seen from outside — and these two are what each
 *  way in actually offers: a skyline that is still deciding itself, and a table the
 *  player plans the life on. Keyed by nothing, because the screen has no world yet:
 *  this is the one place in the app where art is chosen by the door, not by data. */
export const genesisSurprise = require('../../assets/img/genesis-surprise.jpg') as ImageSourcePropType;
export const genesisGuided = require('../../assets/img/genesis-guided.jpg') as ImageSourcePropType;

/** Keyed by `WorldSummary.rulepackId` — the only world identity the API gives the
 *  client (ADR-019), so it is the only key the art can honestly be looked up by. */
const HEROES: Record<string, ImageSourcePropType> = {
  'glass-harbor-2034': require('../../assets/img/glass-harbor-hero.jpg') as ImageSourcePropType,
};

/** Keyed by the `location` value in the shipped template catalogue (UI03). */
const PLATES: Record<string, ImageSourcePropType> = {
  singapore: require('../../assets/img/location-singapore.jpg') as ImageSourcePropType,
  copenhagen: require('../../assets/img/location-copenhagen.jpg') as ImageSourcePropType,
  lagos: require('../../assets/img/location-lagos.jpg') as ImageSourcePropType,
  mars: require('../../assets/img/location-mars.jpg') as ImageSourcePropType,
};

/** Keyed by the character's own name, which is the only form of it the client ever
 *  receives — the engine writes names into prose and choice copy, and §11 has no cast
 *  route. A portrait with no name beside it in the catalogue is therefore not shown at
 *  all rather than guessed at, and `setting.test.ts` keeps the six names in the client
 *  catalogue equal to the six in `core/src/glassHarbor.ts`. */
const CAST: Record<string, ImageSourcePropType> = {
  'Alex Vale': require('../../assets/img/cast-alex-vale.jpg') as ImageSourcePropType,
  'Mara Venn': require('../../assets/img/cast-mara-venn.jpg') as ImageSourcePropType,
  'Ilya Chen': require('../../assets/img/cast-ilya-chen.jpg') as ImageSourcePropType,
  'Noor Rahman': require('../../assets/img/cast-noor-rahman.jpg') as ImageSourcePropType,
  'Soren Pike': require('../../assets/img/cast-soren-pike.jpg') as ImageSourcePropType,
  'Ada Lin': require('../../assets/img/cast-ada-lin.jpg') as ImageSourcePropType,
};

export function heroFor(rulepackId: string | undefined): ImageSourcePropType | undefined {
  return rulepackId ? HEROES[rulepackId] : undefined;
}

export function plateFor(location: string): ImageSourcePropType | undefined {
  return PLATES[location];
}

export function portraitFor(name: string): ImageSourcePropType | undefined {
  return CAST[name];
}
