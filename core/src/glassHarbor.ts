// Reference world fixture: The Glass Harbor (fictional Singapore 2034).
// Every value below is a test constant from contract section 12, not gameplay balance.

import type { RulePack } from './rulepack.js';

export const GLASS_HARBOR: RulePack = {
  id: 'glass-harbor-2034',
  version: '1.0',
  time: { tickMinutes: 360, maxCatchupTicks: 5, maxWorldTimeJumpMinutes: 1440, ambientProgressPerTick: 1 },
  surpriseBudgetPerDay: 2,
  freeWorldQuota: 1,
  templates: [
    {
      id: 'glass-harbor-2034',
      version: '1.0',
      allowedLocations: ['singapore', 'copenhagen', 'lagos', 'mars'],
      allowedEras: ['2034', '2019', '1888'],
      allowedRoles: ['founder-ceo', 'investigator', 'operations-director'],
      constraints: [
        {
          id: 'mars-needs-alternate-history',
          if: { location: 'mars' },
          requireFlags: ['alternate_history'],
          message: 'Mars settings require an explicit alternate-history flag',
        },
        {
          id: 'victorian-mars-impossible',
          if: { location: 'mars', era: '1888' },
          requireFlags: ['alternate_history'],
          message: 'Ordinary institutional limits apply: 1888 Mars travel is not supported without alternate history',
        },
      ],
      playerCharacterId: 'char_player',
      playerGoals: ['retain_control', 'protect_employees', 'discover_offer_provenance'],
      worldTime: '2034-09-15T09:00:00.000Z',
      characters: [
        { id: 'char_player', name: 'Alex Vale', isPlayer: true, roleIds: ['founder_ceo'], goals: ['retain_control', 'protect_employees', 'discover_offer_provenance'], resources: { cash: 100, influence: 60, credibility: 50 }, profile: { title: 'Founder/CEO, Helix Transit' } },
        { id: 'char_mara', name: 'Mara Venn', isPlayer: false, roleIds: ['cofounder'], goals: ['financial_stability'], resources: {}, profile: { knows: ['fact_offer'] } },
        { id: 'char_ilya', name: 'Ilya Chen', isPlayer: false, roleIds: ['investor'], goals: ['fast_exit'], resources: {}, profile: { knows: ['fact_contract_risk'] } },
        { id: 'char_noor', name: 'Noor Rahman', isPlayer: false, roleIds: ['journalist'], goals: ['verify_provenance'], resources: {}, profile: { knows: ['fact_whistleblower'] } },
        { id: 'char_soren', name: 'Soren Pike', isPlayer: false, roleIds: ['negotiator'], goals: ['acquisition'], resources: {}, profile: { knows: ['fact_secret_link'] } },
        { id: 'char_ada', name: 'Ada Lin', isPlayer: false, roleIds: ['operations_director'], goals: ['employee_security'], resources: {}, profile: { knows: ['fact_contract_risk'] } },
      ],
      relationships: [
        { from: 'char_player', to: 'char_mara', dimension: 'trust', value: 70 },
        { from: 'char_player', to: 'char_ilya', dimension: 'trust', value: 45 },
        { from: 'char_player', to: 'char_noor', dimension: 'trust', value: 35 },
        { from: 'char_player', to: 'char_soren', dimension: 'trust', value: 25 },
        { from: 'char_player', to: 'char_ada', dimension: 'trust', value: 65 },
      ],
      facts: [
        { id: 'fact_offer', label: 'Asterion made an offer to Mara', knownBy: ['char_player', 'char_mara'], verified: true, visibility: 'participants' },
        { id: 'fact_contract_risk', label: 'Upcoming policy change risks the freight contract', knownBy: ['char_player', 'char_ilya', 'char_ada'], verified: true, visibility: 'participants' },
        { id: 'fact_secret_link', label: "Soren's undisclosed link to a prior procurement decision", knownBy: ['char_soren'], verified: true, visibility: 'owner', sensitivePhrase: 'procurement link' },
        { id: 'fact_whistleblower', label: 'Noor holds a partially verified whistleblower tip', knownBy: ['char_noor'], verified: false, visibility: 'owner' },
      ],
      arcs: [
        { id: 'arc_acquisition', arcType: 'acquisition', status: 'open' },
        { id: 'arc_hidden_link', arcType: 'hidden_link', status: 'locked' },
        { id: 'arc_staff_security', arcType: 'staff_security', status: 'locked' },
      ],
      genesisChoiceIds: ['investigate_buyer', 'confront_mara', 'open_negotiation', 'brief_staff'],
    },
  ],
  choices: [
    {
      id: 'investigate_buyer',
      label: 'Investigate the buyer',
      copy: 'You spend the morning tracing Asterion Holdings through procurement records.',
      availableFromGenesis: true,
      requires: [{ resource: { character: 'player', key: 'cash', min: 10 } }],
      effects: {
        resources: [{ character: 'player', key: 'cash', delta: -10 }],
        relationships: [{ from: 'player', to: 'char_noor', dimension: 'trust', delta: 6 }],
        // A lead, not the verified link: T03 asserts the secret stays unverified.
        discloseFacts: [{ factId: 'fact_whistleblower', to: 'player', via: 'disclosure' }],
        arcs: [{ arc: 'arc_acquisition', action: 'progress' }],
      },
    },
    {
      id: 'confront_mara',
      label: 'Confront Mara',
      copy: 'You put the offer on the table between you and ask her to look at it.',
      availableFromGenesis: true,
      requires: [{ characterActive: 'char_mara' }],
      effects: {
        resources: [{ character: 'player', key: 'credibility', delta: 2 }],
        relationships: [{ from: 'player', to: 'char_mara', dimension: 'trust', delta: -12 }],
        arcs: [
          { arc: 'arc_acquisition', action: 'progress' },
          { arc: 'arc_hidden_link', action: 'open', when: { relationshipBelow: { from: 'player', to: 'char_mara', dimension: 'trust', value: 40 } } },
        ],
      },
    },
    {
      id: 'open_negotiation',
      label: 'Open negotiation',
      copy: 'You signal to Soren Pike that Helix Transit will talk, on your terms.',
      availableFromGenesis: true,
      requires: [{ resource: { character: 'player', key: 'influence', min: 10 } }],
      effects: {
        resources: [{ character: 'player', key: 'influence', delta: -10 }],
        relationships: [
          { from: 'player', to: 'char_mara', dimension: 'trust', delta: 3 },
          { from: 'player', to: 'char_ilya', dimension: 'trust', delta: 5 },
        ],
        arcs: [{ arc: 'arc_acquisition', action: 'progress' }],
        createFacts: [{ factId: 'fact_exclusivity_demand', label: 'The buyer may demand exclusivity', knownBy: ['player', 'char_soren'], verified: false, visibility: 'participants' }],
        // Opening negotiations gives the founder standing to decide (reference table:
        // "Reject sale | negotiation open, sufficient decision authority").
        flags: { decision_authority: true },
        openChoices: ['reject_sale'],
      },
    },
    {
      id: 'brief_staff',
      label: 'Brief staff',
      copy: 'You gather the operations team and tell them what you can.',
      availableFromGenesis: true,
      requires: [{ resource: { character: 'player', key: 'credibility', min: 5 } }],
      effects: {
        resources: [{ character: 'player', key: 'credibility', delta: -5 }],
        relationships: [
          { from: 'player', to: 'char_ada', dimension: 'trust', delta: 10 },
          { from: 'player', to: 'char_ilya', dimension: 'trust', delta: -4 },
        ],
        arcs: [{ arc: 'arc_staff_security', action: 'open' }],
        discloseFacts: [{ factId: 'fact_contract_risk', to: 'char_ada', via: 'disclosure' }],
      },
    },
    {
      id: 'verify_memo',
      label: 'Verify the leaked memo',
      copy: 'You cross-check the memo against the procurement archive.',
      requires: [
        { knowsFact: { character: 'player', factId: 'fact_memo_claim' } },
        { arcStatus: { arc: 'arc_hidden_link', status: 'locked' } },
      ],
      effects: {
        resources: [{ character: 'player', key: 'cash', delta: -5 }],
        arcs: [{ arc: 'arc_hidden_link', action: 'open' }],
        createFacts: [{ factId: 'fact_archive_query', label: 'A procurement archive query was filed', knownBy: ['player'], verified: true, visibility: 'owner' }],
        discloseFacts: [{ factId: 'fact_memo_claim', to: 'char_noor', via: 'disclosure' }],
      },
    },
    {
      id: 'reject_sale',
      label: 'Reject the sale',
      copy: 'You tell Asterion that Helix Transit is not for sale.',
      requires: [
        { arcStatus: { arc: 'arc_acquisition', status: 'open' } },
        { flag: { key: 'decision_authority', equals: true } },
      ],
      effects: {
        arcs: [{ arc: 'arc_acquisition', action: 'resolve' }],
        createFacts: [{ factId: 'fact_rival_alliance', label: 'A rival alliance becomes eligible later', knownBy: ['player'], verified: false, visibility: 'owner' }],
      },
    },
  ],
  surprises: [
    {
      id: 'leaked_memo',
      cooldownWorldHours: 24,
      causalArc: 'arc_acquisition',
      copy: 'A memo surfaces that links Asterion to an older procurement decision.',
      requires: [
        { arcStatus: { arc: 'arc_acquisition', status: 'open' } },
      ],
      effects: {
        // Noor obtains a claim, not a verified fact. The secret link is never disclosed.
        createFacts: [{ factId: 'fact_memo_claim', label: 'Leaked memo claims a procurement link', knownBy: ['char_noor', 'player'], verified: false, visibility: 'participants' }],
        openChoices: ['verify_memo'],
      },
    },
  ],
};
