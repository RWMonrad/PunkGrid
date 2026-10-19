// UI10's report flow, reachable from an episode (FR-11 / US13). The vocabulary is
// the `reason` enum the route accepts, and the note is capped where migration 009
// caps it, so the field cannot be the reason a submission fails.

import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, type ModerationReason, type ReportAck } from '../lib/api';
import { describe } from '../lib/session';
import { color, focusRing, font, maxFontScale, onAccent, radius, space, touchTarget } from '../lib/theme';

const REASONS: { value: ModerationReason; label: string }[] = [
  { value: 'sexual_content', label: 'Sexual content' },
  { value: 'violence', label: 'Violence' },
  { value: 'self_harm', label: 'Self-harm' },
  { value: 'real_person', label: 'A real person is depicted' },
  { value: 'offensive_language', label: 'Offensive language' },
  { value: 'other', label: 'Something else' },
];

const NOTE_LIMIT = 200;

interface Props {
  visible: boolean;
  episodeLabel: string;
  onClose: () => void;
  onSubmit: (reason: ModerationReason, note?: string) => Promise<ReportAck>;
}

export function ReportSheet({ visible, episodeLabel, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState<ModerationReason>('other');
  const [note, setNote] = useState('');
  // SC 2.4.7: the note field is drawn by this sheet, so its focus is drawn here too —
  // a TextInput gives no style callback, so the state is the only way to know.
  const [noteFocused, setNoteFocused] = useState(false);
  // Same reason for the sheet's pressables, and one key for all of them: only one
  // control holds focus at a time. The blur clears the key only if it still owns it,
  // because React Native does not promise that a blur lands before the next focus.
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const focusRingProps = (key: string) => ({
    onFocus: () => setFocusKey(key),
    onBlur: () => setFocusKey((k) => (k === key ? null : k)),
  });
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState<ReportAck | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await onSubmit(reason, note.trim() ? note.trim().slice(0, NOTE_LIMIT) : undefined);
      setAck(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : describe(e));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setAck(null);
    setNote('');
    setReason('other');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} transparent>
      <View style={styles.sheet}>
        {ack ? (
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.title} maxFontSizeMultiplier={maxFontScale.chrome} accessibilityRole="header">
              Report received
            </Text>
            <Text style={styles.receiptLabel} maxFontSizeMultiplier={maxFontScale.chrome}>Your reference</Text>
            <Text style={styles.receipt} maxFontSizeMultiplier={maxFontScale.chrome} accessibilityLabel={`Reference ${ack.receipt}`}>
              {ack.receipt}
            </Text>
            <Text style={styles.line} maxFontSizeMultiplier={maxFontScale.body}>
              {ack.status === 'duplicate'
                ? 'This scene was already reported with the same reason. Your original report is still open — nothing was filed twice.'
                : 'A reviewer will look at this scene. The case holds the reason code, the categories our filter detected, and a short excerpt — not the whole story.'}
            </Text>
            <Pressable accessibilityRole="button" onPress={close} {...focusRingProps('done')} style={[styles.done, focusKey === 'done' && focusRing]}>
              <Text style={styles.doneText} maxFontSizeMultiplier={maxFontScale.chrome}>Done</Text>
            </Pressable>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.title} maxFontSizeMultiplier={maxFontScale.chrome} accessibilityRole="header">
              Report this scene
            </Text>
            <Text style={styles.scene} maxFontSizeMultiplier={maxFontScale.body}>
              {episodeLabel}
            </Text>

            <Text style={styles.legend} maxFontSizeMultiplier={maxFontScale.chrome}>What is the problem?</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Reason for reporting">
              {REASONS.map((r) => (
                <Pressable
                  key={r.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: reason === r.value }}
                  onPress={() => setReason(r.value)}
                  {...focusRingProps(r.value)}
                  style={[styles.reasonRow, focusKey === r.value && focusRing]}
                >
                  <View style={[styles.radio, reason === r.value && styles.radioOn]} />
                  <Text style={styles.reasonLabel} maxFontSizeMultiplier={maxFontScale.chrome}>
                    {r.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.legend} maxFontSizeMultiplier={maxFontScale.chrome}>(Optional) Anything a reviewer should know? {note.length}/{NOTE_LIMIT}</Text>
            <TextInput
              value={note}
              onChangeText={(v) => setNote(v.slice(0, NOTE_LIMIT))}
              multiline
              maxLength={NOTE_LIMIT}
              placeholder="Keep it short; this is not where the story goes."
              placeholderTextColor={color.muted}
              style={[styles.note, noteFocused && focusRing]}
              onFocus={() => setNoteFocused(true)}
              onBlur={() => setNoteFocused(false)}
              accessibilityLabel="Optional note for the reviewer"
            />

            {error ? (
              <Text style={styles.error} maxFontSizeMultiplier={maxFontScale.body} accessibilityLiveRegion="assertive">
                {error}
              </Text>
            ) : null}

            <View style={styles.actions}>
              <Pressable accessibilityRole="button" onPress={close} {...focusRingProps('cancel')} style={[styles.cancel, focusKey === 'cancel' && focusRing]}>
                <Text style={styles.cancelText} maxFontSizeMultiplier={maxFontScale.chrome}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={busy ? 'Submitting report' : 'Submit report'}
                onPress={() => void submit()}
                disabled={busy}
                {...focusRingProps('submit')}
                style={({ pressed }) => [styles.submit, focusKey === 'submit' && focusRing, pressed && styles.submitPressed, busy && styles.disabled]}
              >
                <Text style={styles.submitText} maxFontSizeMultiplier={maxFontScale.chrome}>{busy ? 'Submitting…' : 'Submit'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: color.ink, justifyContent: 'flex-end' },
  body: { padding: space.lg, gap: space.md, backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  title: { color: color.text, fontSize: font.title, fontWeight: '700' },
  scene: { color: color.muted, fontSize: font.label },
  legend: { color: color.text, fontSize: font.label, fontWeight: '700', marginTop: space.sm },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touchTarget },
  radio: { width: 20, height: 20, borderRadius: radius.lg, borderWidth: 2, borderColor: color.muted },
  radioOn: { borderColor: color.violet, backgroundColor: color.violet },
  reasonLabel: { color: color.text, fontSize: font.body, flex: 1 },
  note: {
    minHeight: 88,
    textAlignVertical: 'top',
    padding: space.md,
    backgroundColor: color.ink,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    color: color.text,
    fontSize: font.body,
  },
  error: { color: color.danger, fontSize: font.label },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md },
  cancel: { flex: 1, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: color.line },
  cancelText: { color: color.muted, fontSize: font.body, fontWeight: '600' },
  submit: { flex: 1, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: color.violet },
  submitPressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  submitText: { color: onAccent, fontSize: font.body, fontWeight: '700' },
  receiptLabel: { color: color.muted, fontSize: font.caption },
  receipt: { color: color.cyan, fontSize: font.lead, fontWeight: '700', letterSpacing: 1 },
  line: { color: color.text, fontSize: font.body },
  done: { minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', backgroundColor: color.violet, borderRadius: radius.md, marginTop: space.md },
  doneText: { color: onAccent, fontSize: font.body, fontWeight: '700' },
});
