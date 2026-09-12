/**
 * The one camera, and the chooser in front of it.
 *
 * ── WHY THIS IS IN THE CORE ───────────────────────────────────────────────
 *
 * Food photos belong to health-diet, body photos to whichever module owns
 * body data, medication photos to health-meds. Each owns its DATA. None of
 * them can own the INTERFACE, because a module cannot reach into a sibling
 * and `switchMode` only moves between modes of the same module — so a food
 * camera could never hand off to a body one. The core draws the camera and
 * asks what the photo is of; the modules answer through `photoKinds`.
 *
 * ── THE CHOOSER DOES NOT REMEMBER ─────────────────────────────────────────
 *
 * It opens on Food every time. Remembering the last choice would make the
 * frequent case one tap, and the failure it invites is the whole reason not
 * to: someone photographs a plate while the app is still in body mode, or
 * worse, in medication mode. Starting from the same place every time means
 * the chooser is never lying about what it is about to do.
 *
 * ── AND NOTHING IS SAVED TO THE DEVICE ────────────────────────────────────
 *
 * A capture stays in the app's cache directory until its module uploads it.
 * It never reaches the photo library — the app ships no media-library
 * permission, so it could not — and never `Documents`, which is in iCloud
 * backup and forbidden for health data by Apple's guideline 5.1.3(ii). A
 * sequence holds nothing back to be written somewhere safer: each step
 * uploads as it is taken, which is also what makes a step skippable.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CameraSurface, CaptureButton, useCameraPermissions } from '../capabilities/camera';
import { normalisePhoto } from '../capabilities/imagePicker';
import { Icon } from '../components/Icon';
import { LazyThunk } from '../components/LazyThunk';
import { Body, Button, Caps, Caption, Card, EmptyState } from '../components/primitives';
import { GlassPanel } from '../components/GlassPanel';
import { photoKinds } from './registry';
import { useChromeInsets } from './chrome';
import { useTheme, radius, spacing, layout } from '../theme/tokens';

export function CameraMode({ onDismiss }: { onDismiss?: () => void }) {
  const theme = useTheme();
  const chrome = useChromeInsets();
  const kinds = useMemo(() => photoKinds(), []);
  const [permission, requestPermission] = useCameraPermissions();

  /** null = the chooser is up. */
  const [kindId, setKindId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  /** The shot waiting to be handed to its module. */
  const [captured, setCaptured] = useState<{ uri: string; stepId: string } | null>(null);
  const cameraRef = React.useRef<React.ComponentRef<typeof CameraSurface>>(null);

  const kind = kinds.find((k) => k.id === kindId) ?? null;
  const step = kind?.steps[stepIndex] ?? null;

  const reset = useCallback(() => {
    setKindId(null);
    setStepIndex(0);
    setCaptured(null);
  }, []);

  /** Move past the current step, whether it was taken or skipped. */
  const advance = useCallback(() => {
    setCaptured(null);
    setStepIndex((i) => {
      const next = i + 1;
      if (kind && next >= kind.steps.length) {
        // The last step is done: back to the chooser rather than a dead end.
        reset();
        return 0;
      }
      return next;
    });
  }, [kind, reset]);

  const capture = useCallback(async () => {
    if (!step) return;
    try {
      const shot = await cameraRef.current?.takePictureAsync({ quality: 0.85 });
      if (!shot?.uri) return;
      // The device shoots HEIC on its default setting; every module wants the
      // same JPEG shape, so this is normalised once here rather than three
      // times in three modules.
      const photo = await normalisePhoto(shot.uri);
      setCaptured({ uri: photo.uri, stepId: step.id });
    } catch {
      // A failed shutter is not worth a dialog: the preview is still up and
      // the button is still there.
    }
  }, [step]);

  if (kinds.length === 0) {
    return (
      <EmptyState
        icon="camera"
        title="Nothing to photograph yet"
        body="Photos appear here once the parts of the app that use them are switched on for you."
      />
    );
  }

  // ── The chooser ─────────────────────────────────────────────────────────
  if (!kind) {
    return (
      <View style={[styles.fill, { paddingTop: chrome.top, paddingBottom: chrome.bottom }]}>
        <View style={styles.chooser}>
          <Caps>What are you photographing?</Caps>
          {kinds.map((k) => (
            <Pressable key={`${k.moduleId}:${k.id}`} onPress={() => { setStepIndex(0); setKindId(k.id); }}>
              <Card>
                <View style={styles.row}>
                  <Icon name={k.icon} size={22} color={theme.text} />
                  <Body style={{ flex: 1, fontWeight: '600' }}>{k.label}</Body>
                  {k.steps.length > 1 ? (
                    <Caption>{`${k.steps.length} photos`}</Caption>
                  ) : null}
                  <Icon name="chevron-right" size={16} color={theme.textMuted} />
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  // ── A shot is waiting for its module to deal with it ────────────────────
  if (captured) {
    return (
      <LazyThunk
        key={`${kind.moduleId}:${kind.id}:${captured.stepId}`}
        thunk={kind.surface}
        props={{
          uri: captured.uri,
          stepId: captured.stepId,
          // Taken and dealt with: go to the next step, or finish.
          onDone: advance,
          // Discarded: stay on this step so it can be retaken.
          onCancel: () => setCaptured(null),
        }}
      />
    );
  }

  // ── The preview ─────────────────────────────────────────────────────────
  if (!permission?.granted) {
    return (
      <View style={styles.centered}>
        <EmptyState
          icon="camera-off"
          title="The camera is off for this app"
          body="Photos need the camera. You can turn it on in Settings, Privacy, Camera."
          action={<Button title="Allow the camera" onPress={() => void requestPermission()} />}
        />
      </View>
    );
  }

  const multi = kind.steps.length > 1;
  return (
    <View style={styles.fill}>
      <CameraSurface ref={cameraRef} facing="back">
        {step?.overlay ? <LazyThunk key={step.id} thunk={step.overlay} /> : null}
      </CameraSurface>

      <View style={[styles.chrome, { paddingTop: chrome.top }]} pointerEvents="box-none">
        <GlassPanel radius={radius.full} style={styles.pill}>
          <Caps>{multi ? `${kind.label} · ${step?.label ?? ''}` : kind.label}</Caps>
        </GlassPanel>
      </View>

      <View style={[styles.controls, { paddingBottom: chrome.bottom + spacing.md }]} pointerEvents="box-none">
        {step?.hint ? (
          <GlassPanel radius={radius.composer} style={styles.hint}>
            <Caption>{step.hint}</Caption>
          </GlassPanel>
        ) : null}
        <View style={styles.buttonRow}>
          {/* Back to the chooser, so a wrong turn costs one tap. */}
          <Button title="Back" variant="ghost" onPress={reset} />
          <CaptureButton onPress={() => void capture()} />
          {/* Skippable, and only where there is a sequence to skip within.
              What has already been taken is already uploaded and kept. */}
          {multi ? (
            <Button title="Skip" variant="ghost" onPress={advance} />
          ) : (
            <Button title="Close" variant="ghost" onPress={() => (onDismiss ? onDismiss() : reset())} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center' },
  chooser: { padding: layout.composerMargin, gap: spacing.sm, justifyContent: 'center', flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chrome: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  pill: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, marginTop: spacing.md },
  controls: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: spacing.md, alignItems: 'center' },
  hint: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, marginHorizontal: spacing.lg },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: spacing.xl,
  },
});
