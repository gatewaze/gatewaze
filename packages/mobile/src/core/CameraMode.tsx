/**
 * The one camera, with what-is-this underneath it.
 *
 * ── WHY THIS IS IN THE CORE ───────────────────────────────────────────────
 *
 * Food photos belong to health-diet, body photos to whichever module owns
 * body data, medication photos to health-meds. Each owns its DATA. None of
 * them can own the INTERFACE, because a module cannot reach into a sibling
 * and `switchMode` only moves between modes of the same module — so a food
 * camera could never hand off to a body one. The core draws the camera and
 * the modules answer, through `photoKinds`.
 *
 * ── THE CAMERA IS ALREADY OPEN, AND THE CHOICE SITS UNDER IT ──────────────
 *
 * An earlier version asked what the photo was of on a screen of its own and
 * opened the camera afterwards. That put a question in front of somebody who
 * had already decided, and it cost a tap on every photo — including the food
 * ones taken several times a day. The preview is up immediately on Food, and
 * the other two are one tap away, so the common case is press the shutter.
 *
 * The preview is inset with rounded corners rather than full bleed, matching
 * the barcode scanner, which is the size these surfaces have always been.
 *
 * ── THE CHOICE DOES NOT PERSIST ───────────────────────────────────────────
 *
 * It returns to Food every time this opens. Remembering would save a tap for
 * somebody who mostly takes body photos, and the failure it invites is the
 * reason not to: photographing a plate while the app is still set to
 * medication.
 *
 * ── AND NOTHING IS SAVED TO THE DEVICE ────────────────────────────────────
 *
 * A capture stays in the app's cache until its module uploads it. It never
 * reaches the photo library — the app ships no media-library permission, so
 * it could not — and never `Documents`, which is in iCloud backup and
 * forbidden for health data by Apple's guideline 5.1.3(ii). Each step of a
 * sequence uploads as it is taken, which is also what makes a step skippable.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraSurface, CaptureButton } from '../capabilities/camera';
import { normalisePhoto } from '../capabilities/imagePicker';
import { Icon } from '../components/Icon';
import { LazyThunk } from '../components/LazyThunk';
import { Button, Caption, EmptyState } from '../components/primitives';
import { photoKinds } from './registry';
import { useChromeInsets } from './chrome';
import { useTheme, radius, spacing, layout, type } from '../theme/tokens';

export function CameraMode({ onDismiss }: { onDismiss?: () => void }) {
  const theme = useTheme();
  const chrome = useChromeInsets();
  const kinds = useMemo(() => photoKinds(), []);

  // Food is first by its `order`, and is where this opens every time.
  const [kindId, setKindId] = useState<string | null>(kinds[0]?.id ?? null);
  const [stepIndex, setStepIndex] = useState(0);
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [captured, setCaptured] = useState<{ uri: string; stepId: string } | null>(null);
  const cameraRef = React.useRef<React.ComponentRef<typeof CameraSurface>>(null);

  const kind = kinds.find((k) => k.id === kindId) ?? kinds[0] ?? null;
  const step = kind?.steps[stepIndex] ?? null;
  const multi = (kind?.steps.length ?? 0) > 1;

  // Switching what the photo is OF starts that kind at its first step. A body
  // sequence half-done does not carry over to a meal.
  const choose = useCallback((id: string) => {
    setKindId(id);
    setStepIndex(0);
    setCaptured(null);
  }, []);

  useEffect(() => {
    if (!kindId && kinds[0]) setKindId(kinds[0].id);
  }, [kindId, kinds]);

  const advance = useCallback(() => {
    setCaptured(null);
    setStepIndex((i) => {
      const next = i + 1;
      // The end of a sequence returns to its first step, so the camera is
      // ready for the next set rather than stuck past the end.
      if (kind && next >= kind.steps.length) return 0;
      return next;
    });
  }, [kind]);

  const capture = useCallback(async () => {
    if (!step) return;
    try {
      const shot = await cameraRef.current?.takePictureAsync({ quality: 0.85 });
      if (!shot?.uri) return;
      // The device shoots HEIC on its default setting, and every module wants
      // the same JPEG shape, so this is normalised once here rather than
      // three times in three modules.
      const photo = await normalisePhoto(shot.uri);
      setCaptured({ uri: photo.uri, stepId: step.id });
    } catch {
      // A failed shutter needs no dialog: the preview is still up and the
      // button is still there.
    }
  }, [step]);

  if (kinds.length === 0 || !kind) {
    return (
      <EmptyState
        icon="camera"
        title="Nothing to photograph yet"
        body="Photos appear here once the parts of the app that use them are switched on for you."
      />
    );
  }

  // A shot is with its module: analysing, confirming, uploading.
  if (captured) {
    return (
      <LazyThunk
        key={`${kind.moduleId}:${kind.id}:${captured.stepId}`}
        thunk={kind.surface}
        props={{
          uri: captured.uri,
          stepId: captured.stepId,
          onDone: advance,
          onCancel: () => setCaptured(null),
        }}
      />
    );
  }

  return (
    <View style={[styles.fill, { paddingTop: chrome.top, paddingBottom: chrome.bottom }]}>
      <View style={styles.preview}>
        <CameraSurface ref={cameraRef} facing={facing}>
          {step?.overlay ? <LazyThunk key={`${kind.id}:${step.id}`} thunk={step.overlay} /> : null}

          {/* Front and back. A progress photo in a mirror is taken with the
              selfie camera, and there was no way to reach it. */}
          <Pressable
            onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
            accessibilityLabel="Switch camera"
            hitSlop={10}
            style={styles.flip}
          >
            <Icon name="swap-horizontal" size={20} color="#fff" />
          </Pressable>

          {multi ? (
            <View style={styles.stepPill}>
              <Text style={styles.overlayText}>
                {`${step?.label ?? ''} · ${stepIndex + 1} of ${kind.steps.length}`}
              </Text>
            </View>
          ) : null}

          {step?.hint ? (
            <View style={styles.hintWrap}>
              <Text style={styles.overlayText}>{step.hint}</Text>
            </View>
          ) : null}
        </CameraSurface>
      </View>

      {/* What the photo is of. Always visible, so changing it is one tap and
          never a screen. */}
      <View style={styles.kinds}>
        {kinds.map((k) => {
          const selected = k.id === kind.id;
          return (
            <Pressable
              key={`${k.moduleId}:${k.id}`}
              onPress={() => choose(k.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                styles.kind,
                {
                  backgroundColor: selected ? theme.invert : theme.controlFill,
                  borderColor: selected ? theme.invert : theme.controlBorder,
                },
              ]}
            >
              <Icon name={k.icon} size={17} color={selected ? theme.onInvert : theme.textSecondary} />
              <Text
                numberOfLines={1}
                style={[type.button, { color: selected ? theme.onInvert : theme.textSecondary }]}
              >
                {k.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.controls}>
        {/* Only where there is a sequence to skip within. What has already
            been taken is already uploaded and kept. */}
        {multi ? (
          <Button title="Skip" variant="ghost" onPress={advance} />
        ) : (
          <View style={styles.spacer} />
        )}
        <CaptureButton onPress={() => void capture()} />
        <Button title="Close" variant="ghost" onPress={() => onDismiss?.()} />
      </View>

      {multi ? (
        <Caption style={styles.note}>Any of these can be skipped.</Caption>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Inset with rounded corners, the same shape as the barcode scanner.
  preview: { flex: 1, padding: spacing.md },
  flip: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.full,
    padding: spacing.sm,
  },
  stepPill: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  hintWrap: { position: 'absolute', bottom: spacing.lg, left: spacing.lg, right: spacing.lg, alignItems: 'center' },
  overlayText: {
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    fontSize: 13,
    overflow: 'hidden',
    textAlign: 'center',
  },
  kinds: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: layout.composerMargin,
    paddingTop: spacing.xs,
  },
  kind: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    // The HIG's minimum, like every other control in the composer.
    height: layout.tapTarget,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  spacer: { width: 64 },
  note: { textAlign: 'center', paddingBottom: spacing.xs },
});
