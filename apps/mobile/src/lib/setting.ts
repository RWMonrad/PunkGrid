// The bounded setup vocabulary for UI03 (US03). §11 has no template-listing
// route, so the client ships the shipped templates as data and the server stays
// the authority: this file's job is to explain a rejected combination before a
// request costs a world quota, not to decide what is valid.

export interface SettingInput {
  era: string;
  location: string;
  role: string;
  genre?: string;
  flags?: string[];
}

export interface TemplateCatalog {
  id: string;
  version: string;
  title: string;
  premise: string;
  genre: string;
  locations: { value: string; label: string }[];
  eras: { value: string; label: string }[];
  roles: { value: string; label: string }[];
  flags: { value: string; label: string }[];
  /** The people a life in this world meets. The engine keeps the cast in its own
   *  template and §11 has no route that delivers it, so the names are shipped here as
   *  data — the same arrangement as the places and the roles, and the reason
   *  `setting.test.ts` reads `core/src/glassHarbor.ts` and refuses a name the server
   *  does not have. `you` marks the one the player's identity is written from. */
  cast: { name: string; role: string; you?: boolean }[];
  /** Same shape as `SettingConstraint` in the rulepack. */
  constraints: { id: string; if: Partial<Pick<SettingInput, 'era' | 'location' | 'role'>>; requireFlags: string[]; message: string }[];
}

export const GLASS_HARBOR: TemplateCatalog = {
  id: 'glass-harbor-2034',
  version: '1.0',
  title: 'The Glass Harbor',
  premise:
    'You lead Helix Transit, a logistics software firm in an alternative Singapore of 2034. Your cofounder has quietly received an acquisition offer, a policy change could undermine your biggest contract, and a whistleblower claims someone influenced the sale process.',
  genre: 'speculative-corporate-mystery',
  locations: [
    { value: 'singapore', label: 'Singapore' },
    { value: 'copenhagen', label: 'Copenhagen' },
    { value: 'lagos', label: 'Lagos' },
    { value: 'mars', label: 'Mars' },
  ],
  eras: [
    { value: '2034', label: '2034' },
    { value: '2019', label: '2019' },
    { value: '1888', label: '1888' },
  ],
  roles: [
    { value: 'founder-ceo', label: 'Founder / CEO' },
    { value: 'investigator', label: 'Investigator' },
    { value: 'operations-director', label: 'Operations director' },
  ],
  flags: [
    { value: 'alternate_history', label: 'Alternate history' },
    { value: 'hard_technology', label: 'Hard technology' },
  ],
  cast: [
    { name: 'Alex Vale', role: 'Founder / CEO', you: true },
    { name: 'Mara Venn', role: 'Co-founder' },
    { name: 'Ilya Chen', role: 'Investor' },
    { name: 'Noor Rahman', role: 'Journalist' },
    { name: 'Soren Pike', role: 'Acquisition negotiator' },
    { name: 'Ada Lin', role: 'Operations director' },
  ],
  constraints: [
    {
      id: 'mars-needs-alternate-history',
      if: { location: 'mars' },
      requireFlags: ['alternate_history'],
      message: 'A Mars setting needs the alternate-history flag: ordinary institutional limits do not carry you there.',
    },
    {
      id: 'victorian-mars-impossible',
      if: { location: 'mars', era: '1888' },
      requireFlags: ['alternate_history'],
      message: '1888 Mars travel is not supported without alternate history.',
    },
  ],
};

export const CATALOGS: TemplateCatalog[] = [GLASS_HARBOR];

export function catalogFor(id: string): TemplateCatalog | undefined {
  return CATALOGS.find((c) => c.id === id);
}

/** A readable reason for every bounded choice the server would refuse, so the
 *  create button can say why it is disabled instead of failing after a tap. */
export function checkSetting(t: TemplateCatalog, setting: SettingInput): string[] {
  const problems: string[] = [];
  if (!t.locations.some((l) => l.value === setting.location)) problems.push(`${setting.location} is not a place this world supports.`);
  if (!t.eras.some((e) => e.value === setting.era)) problems.push(`${setting.era} is not an era this world supports.`);
  if (!t.roles.some((r) => r.value === setting.role)) problems.push(`${setting.role} is not a role this world supports.`);
  for (const c of t.constraints) {
    const matches = Object.entries(c.if).every(([key, value]) => setting[key as 'era' | 'location' | 'role'] === value);
    if (!matches) continue;
    const missing = c.requireFlags.filter((f) => !(setting.flags ?? []).includes(f));
    if (missing.length > 0) problems.push(c.message);
  }
  return problems;
}

export function labelFor(t: TemplateCatalog, kind: 'era' | 'location' | 'role', value: string): string {
  const list = kind === 'era' ? t.eras : kind === 'location' ? t.locations : t.roles;
  return list.find((o) => o.value === value)?.label ?? value;
}
