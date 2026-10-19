// F02 — the guest preview. Master §2 lets a player defer sign-in until *after*
// trying a scene, and §5.3 has no screen for that, so this is the whole feature:
// one authored opening, four decisions, four consequences, all of it in the bundle.
//
// It is not the Reality Engine and does not pretend to be. The engine keeps a
// ledger, bounds every value by rules, and needs a server; this file keeps nothing
// and invents nothing. What it proves to a player is the one thing a screenshot
// cannot: that a choice here is answered in words, and that the answer costs
// something. `preview.test.ts` measures the claim that no request leaves the device.

export interface PreviewScene {
  id: string;
  kicker: string;
  paragraphs: string[];
  /** Empty on a consequence: the preview is two scenes deep by design, because a
   *  third would need state to be worth reading. */
  choices: PreviewChoice[];
  /** What the last decision moved. Shown on the consequence screen as the receipt
   *  UI06 shows for a real world. */
  receipt?: string;
}

export interface PreviewChoice {
  choiceId: string;
  label: string;
  copy: string;
  outcome: PreviewScene;
}

const outcome = (
  id: string,
  choiceId: string,
  paragraphs: string[],
  receipt: string,
): PreviewScene => ({
  id: `harbor-${id}`,
  kicker: `The Glass Harbor · 2034 · ${choiceId}`,
  paragraphs,
  choices: [],
  receipt,
});

const choice = (choiceId: string, label: string, copy: string, result: PreviewScene): PreviewChoice => ({
  choiceId,
  label,
  copy,
  outcome: result,
});

export const PREVIEW_TITLE = 'The Glass Harbor';

/** The one scene every player sees before they decide whether to stay. Names and
 *  institutions are the fixture world's (`core/src/glassHarbor.ts`), so a player who
 *  signs in and builds Glass Harbor meets the same people — that continuity is the
 *  point of authoring this against the fixture rather than inventing a demo world. */
export const OPENING: PreviewScene = {
  id: 'harbor-opening',
  kicker: 'The Glass Harbor · 2034 · 06:40',
  paragraphs: [
    'The offer arrives on paper, before the coffee. Nobody in this port sends paper.',
    'Mara Venn wants nine days of Helix Transit’s cargo ledger, and she is paying for the copy you already made. You are Alex Vale, the founder. Ada Lin signed for a crate at the wrong dock and never said which one.',
    'The harbour keeps its accounts. So do you.',
  ],
  choices: [
    choice(
      'brief',
      'Brief staff',
      'You gather the operations team and tell them exactly how much of this they are allowed to know.',
      outcome(
        'brief',
        'A',
        [
          'Four people, one room, and the sound of the rain coming sideways off the water. You say what can be said and stop there.',
          'Nobody asks the question you did not answer. That is the measure of a crew, and you have one.',
        ],
        'Trust in the room goes up. The secret stays yours alone, which is a cost you will pay later.',
      ),
    ),
    choice(
      'confront',
      'Confront Mara',
      'You put the offer on the table between you and ask her to read her own name on it.',
      outcome(
        'confront',
        'B',
        [
          'Mara reads the page twice, slowly, the way people do when they are deciding whether to be insulted.',
          '“You think I wrote this,” she says. It is not a question. She slides the paper back to your side of the table.',
        ],
        'The offer is still on the table, and now you both know who put it there.',
      ),
    ),
    choice(
      'trace',
      'Trace the buyer',
      'You spend the morning reading procurement records until Asterion Holdings stops being a name.',
      outcome(
        'trace',
        'C',
        [
          'Asterion bought the dockside lease in March, nine months before it needed it, through a company that exists in one filing.',
          'The ledger you would be selling is not the thing they want. They want the nine days, which means something in them is dated.',
        ],
        'You now know one fact nobody offered you, and knowing it has already changed what you can un-know.',
      ),
    ),
    choice(
      'terms',
      'Set terms',
      'You tell Soren Pike that Helix Transit will talk, on your terms, in your office, with your record.',
      outcome(
        'terms',
        'D',
        [
          'Soren takes forty minutes to answer a message he reads in four seconds. Then he comes.',
          'He agrees to the record. He does not agree to the price, and the difference between those two is the whole meeting.',
        ],
        'The clock is yours now, which is worth more than the copy and cannot be handed back.',
      ),
    ),
  ],
};

/** The consequence of one decision. Unknown ids come back as the same scene so the
 *  screen cannot render a hole; the preview has no error state because it has no
 *  transport to fail. */
export function chosen(scene: PreviewScene, choiceId: string): PreviewScene {
  return scene.choices.find((c) => c.choiceId === choiceId)?.outcome ?? scene;
}

/** The line that turns the preview into F02's other half: the reason to make an
 *  account is that a real world remembers. */
export const UPGRADE_LINE =
  'One decision, one consequence. This preview stays here. Sign in to begin a new life: its choices are written to a ledger and kept across devices. Your preview choice is not transferred.';
