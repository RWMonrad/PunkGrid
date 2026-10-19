// UI03 — Guided world setup (US03: an incompatible combination is refused with an
// explanation, and no half-created world is left behind). `checkSetting` mirrors the
// rulepack's constraints so the screen can say why before a tap, but the engine
// remains the authority — a world is only created when POST /v1/worlds says so.

import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ArtBand, ArtPlate } from '../components/art';
import { Button, Row } from '../components/Button';
import { ConsentDisclosure, ErrorPanel, ProgressSkeleton, Screen, Section } from '../components/kit';
import { session, useReduceMotion } from '../hooks/useApp';
import { ApiError } from '../lib/api';
import { heroFor, plateFor, portraitFor } from '../lib/art';
import { describe } from '../lib/session';
import { GLASS_HARBOR, checkSetting, type SettingInput, type TemplateCatalog } from '../lib/setting';
import { telemetry, worldRef } from '../lib/telemetry';
import { color, face, focusRing, font, maxFontScale, onAccent, radius, space, touchTarget } from '../lib/theme';

type Field = 'era' | 'location' | 'role';

export default function Setup() {
  const router = useRouter();
  const reduced = useReduceMotion();
  const template = GLASS_HARBOR;

  const [setting, setSetting] = useState<SettingInput>({
    era: template.eras[0]!.value,
    location: template.locations[0]!.value,
    role: template.roles[0]!.value,
    genre: template.genre,
    flags: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<{ payload: string; commandId: string } | null>(null);
  // SC 2.4.7 for a row of pressables: the ring is drawn from `onFocus`/`onBlur`, because
  // RN 0.86's style callback carries `pressed` only. One key holds the focused option of
  // the group, and the blur clears only that key, so an option cannot erase a focus that
  // already moved to the next one.
  const [flagFocus, setFlagFocus] = useState<string | null>(null);

  const problems = useMemo(() => checkSetting(template, setting), [template, setting]);

  const pick = (field: Field, value: string) => setSetting((s) => ({ ...s, [field]: value }));
  const toggleFlag = (value: string) =>
    setSetting((s) => ({
      ...s,
      flags: (s.flags ?? []).includes(value) ? (s.flags ?? []).filter((f) => f !== value) : [...(s.flags ?? []), value],
    }));

  async function create() {
    if (inFlight.current || problems.length > 0) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const api = session.client();
    const payload = JSON.stringify({ templateId: template.id, setting });
    if (attempt.current?.payload !== payload) attempt.current = { payload, commandId: api.newCommandId() };
    const commandId = attempt.current.commandId;
    const started = Date.now();
    try {
      const res = await api.createWorld({ mode: 'create', templateId: template.id, setting, commandId });
      telemetry.track({ name: 'world_created', worldRef: worldRef(res.worldId), templateId: template.id, durationMs: Date.now() - started });
      router.replace({ pathname: '/world/[worldId]', params: { worldId: res.worldId, episodeId: res.episodeId } });
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'WORLD_LIMIT_REACHED'
          ? 'The free quota is used up. This world was not created.'
          : e instanceof ApiError && e.code === 'INVALID_SCHEMA'
            ? `${e.message}${e.details.contentPolicy ? ` (content policy: ${String(e.details.contentPolicy)})` : ''}`
            : describe(e),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Persona synthesizer"
      subtitle="Calibrate the world your consciousness enters. The engine accepts only combinations its rules can honour."
      footer={
        <Button
          label={problems.length > 0 ? 'Fix the combination' : 'Manifest consciousness'}
          onPress={() => void create()}
          disabled={problems.length > 0 || busy}
          busy={busy}
          accessibilityHint={problems.length > 0 ? problems.join(' ') : 'Creates the world and writes the first scene'}
        />
      }
    >
      <View style={styles.premise}>
        <ArtBand source={heroFor(template.id)} height={120} corner={0} style={styles.premiseArt} />
        <Text style={styles.premiseKicker} maxFontSizeMultiplier={maxFontScale.chrome}>
          SELECTED REALM
        </Text>
        <Text style={styles.premiseTitle} maxFontSizeMultiplier={maxFontScale.chrome}>
          {template.title}
        </Text>
        <Text style={styles.premiseText} maxFontSizeMultiplier={maxFontScale.body}>
          {template.premise}
        </Text>
      </View>

      <Places options={template.locations} value={setting.location} onPick={(v) => pick('location', v)} />
      <Chips label="WHEN — THE ERA" field="era" options={template.eras.map((e) => e)} value={setting.era} onPick={pick} />
      <Chips label="WHO — THE ROLE" field="role" options={template.roles.map((r) => r)} value={setting.role} onPick={pick} />

      <Cast people={template.cast} roleLabel={template.roles.find((r) => r.value === setting.role)?.label} />

      <Section title="REALITY FLAGS">
        <View style={styles.chipRow}>
          {template.flags.map((f) => {
            const on = (setting.flags ?? []).includes(f.value);
            return (
              <Pressable
                key={f.value}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => toggleFlag(f.value)}
                onFocus={() => setFlagFocus(f.value)}
                onBlur={() => setFlagFocus((k) => (k === f.value ? null : k))}
                style={[styles.chip, on && styles.chipOn, flagFocus === f.value && focusRing]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]} maxFontSizeMultiplier={maxFontScale.chrome}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      {problems.length > 0 ? (
        <View style={styles.problems} accessibilityLiveRegion="polite">
          {problems.map((p) => (
            <Text key={p} style={styles.problemText} maxFontSizeMultiplier={maxFontScale.body}>
              {'· '}
              {p}
            </Text>
          ))}
        </View>
      ) : null}

      {busy ? <ProgressSkeleton label="Writing the blueprint" reducedMotion={reduced} /> : null}
      {error ? <ErrorPanel title="The world was not created" message={error} onRetry={() => void create()} retryLabel="Try again with the same command" /> : null}

      <ConsentDisclosure />
    </Screen>
  );
}

/** UI03's `Where` row: the places a world can open in, shown as the pictures they
 *  are. The plate is decoration — the name under it is the radio's own label, so
 *  the group reads and behaves the same with the art removed (NFR-07). */
function Places({ options, value, onPick }: { options: { value: string; label: string }[]; value: string; onPick: (value: string) => void }) {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  return (
    <Section title="WHERE — THE ANCHOR">
      <View accessibilityRole="radiogroup" accessibilityLabel="Where">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.placeRow}>
          {options.map((o) => (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: value === o.value }}
              onPress={() => onPick(o.value)}
              onFocus={() => setFocusKey(o.value)}
              onBlur={() => setFocusKey((k) => (k === o.value ? null : k))}
              style={[styles.place, value === o.value && styles.placeOn, focusKey === o.value && focusRing]}
            >
              <ArtBand source={plateFor(o.value)} height={72} corner={0} />
              <Text style={[styles.placeText, value === o.value && styles.placeTextOn]} maxFontSizeMultiplier={maxFontScale.chrome}>
                {o.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Section>
  );
}

function Chips({ label, field, options, value, onPick }: { label: string; field: Field; options: { value: string; label: string }[]; value: string; onPick: (field: Field, value: string) => void }) {
  const [focusKey, setFocusKey] = useState<string | null>(null);
  return (
    <Section title={label}>
      {/* The chips are a radio group, and a reader only announces that — and which
          one is chosen — when the group itself is declared (NFR-07). */}
      <View accessibilityRole="radiogroup" accessibilityLabel={label}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {options.map((o) => (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: value === o.value }}
              onPress={() => onPick(field, o.value)}
              onFocus={() => setFocusKey(o.value)}
              onBlur={() => setFocusKey((k) => (k === o.value ? null : k))}
              style={[styles.chip, value === o.value && styles.chipOn, focusKey === o.value && focusRing]}
            >
              <Text style={[styles.chipText, value === o.value && styles.chipTextOn]} maxFontSizeMultiplier={maxFontScale.chrome}>
                {o.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Section>
  );
}

/** The people a life in this world meets, shown before the world exists. Not a
 *  control: the role row above is the only choice on the screen, so a portrait you
 *  cannot tap carries no role and no state (NFR-07). `ArtPlate` renders nothing for a
 *  portrait it has no file for, which is the safe direction — an empty frame would be
 *  a lie about the cast, while a missing picture leaves the name and the role exactly
 *  as readable as they were.
 *
 *  A wrapped grid, not the horizontal scroller the `Where` row uses, and the first
 *  screenshot of it is the reason: six plates in a scroll row showed four at 100 %
 *  text, cut the fourth mid-word at the panel edge — «Noor Rahm» — and hid the last
 *  two behind a sideways swipe nobody was told to try. A cast you have to discover is
 *  not a cast. The fixed cell is what makes the wrap hold: without it a plate is as
 *  wide as its own text, and one long role name pushes the row apart. */
function Cast({ people, roleLabel }: { people: TemplateCatalog['cast']; roleLabel?: string }) {
  return (
    <Section title="THE CAST">
      <Row style={styles.castRow}>
        {people.map((p) => (
          <View key={p.name} style={styles.castCell}>
            {/* The engine opens the world on the role the player named (US03), so the
             *  plate that says "you" says that role, not the catalogue's reference one. */}
            <ArtPlate source={portraitFor(p.name)} label={p.you ? `${p.name} · you` : p.name} note={p.you && roleLabel ? roleLabel : p.role} size={96} />
          </View>
        ))}
      </Row>
    </Section>
  );
}

const styles = StyleSheet.create({
  premise: { padding: space.lg, backgroundColor: color.surface, borderRadius: radius.md, gap: space.sm, overflow: 'hidden' },
  premiseArt: { margin: -space.lg, marginBottom: space.xs },
  premiseKicker: { color: color.cyan, fontSize: font.caption, fontWeight: '700', fontFamily: face.monoBold, letterSpacing: 0.8 },
  premiseTitle: { color: color.text, fontSize: font.lead, fontWeight: '700' },
  premiseText: { color: color.muted, fontSize: font.label },
  placeRow: { gap: space.sm, paddingRight: space.lg },
  // Wider air than the place row: a plate carries two lines of text under it, and at
  // 200 % text those lines are what the eye lands on between faces.
  castRow: { gap: space.md, paddingRight: space.lg },
  // Fixed so the six wrap three and three instead of lining up four and scrolling the
  // rest away; see `Cast`.
  castCell: { width: 116 },
  // minWidth, not width: the card sits in a horizontal scroller, so at 200 % text
  // it may grow around a long place name and the player scrolls to it. With a
  // fixed width and `overflow: 'hidden'` the same label was cut in half.
  place: { minWidth: 132, minHeight: touchTarget, gap: space.xs, padding: space.sm, borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  placeOn: { backgroundColor: color.raised, borderColor: color.violet },
  placeText: { color: color.muted, fontSize: font.label, fontWeight: '600' },
  placeTextOn: { color: color.text },
  chipRow: { gap: space.sm, paddingRight: space.lg },
  chip: { paddingHorizontal: space.md, minHeight: touchTarget, justifyContent: 'center', borderRadius: radius.md, backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  chipOn: { backgroundColor: color.violet, borderColor: color.violet },
  chipText: { color: color.muted, fontSize: font.label, fontWeight: '600' },
  chipTextOn: { color: onAccent },
  problems: { gap: space.xs, padding: space.md, backgroundColor: color.surface, borderRadius: radius.md, borderLeftWidth: 3, borderLeftColor: color.danger },
  problemText: { color: color.text, fontSize: font.label },
});
