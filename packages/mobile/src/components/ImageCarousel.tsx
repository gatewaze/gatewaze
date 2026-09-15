/**
 * A swipeable run of images with page dots.
 *
 * Built on a paging ScrollView rather than a carousel library: the behaviour
 * wanted here is one image per swipe with no autoplay, which is exactly what
 * paging already does, and a dependency would have to be audited and carried
 * into every build for it.
 *
 * A single image renders as a plain image with no dots, so a caller does not
 * have to decide which component to use based on how many it has.
 */

import React, { useState } from 'react';
import {
  Image,
  ScrollView,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme, radius as radiusTokens, spacing } from '../theme/tokens';

export interface ImageCarouselProps {
  uris: string[];
  /** Width divided by height. Defaults to a landscape 1.4. */
  aspectRatio?: number;
  /** Horizontal padding the carousel sits inside, so pages line up. */
  gutter?: number;
  style?: StyleProp<ViewStyle>;
}

export function ImageCarousel({
  uris,
  aspectRatio = 1.4,
  gutter = spacing.lg * 2,
  style,
}: ImageCarouselProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);

  const pageWidth = Math.max(1, width - gutter);
  const imageStyle = {
    width: pageWidth,
    aspectRatio,
    borderRadius: radiusTokens.md,
    backgroundColor: theme.surface,
  };

  if (uris.length === 0) return null;
  if (uris.length === 1) {
    // Wrapped rather than merging `style` into the image: the caller's style
    // is a ViewStyle, and an Image takes an ImageStyle, which allows fewer
    // overflow values.
    return (
      <View style={style}>
        <Image source={{ uri: uris[0] }} style={imageStyle} resizeMode="cover" />
      </View>
    );
  }

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Round rather than floor: a swipe that settles a pixel short of the next
    // page should still count as having arrived at it.
    setPage(Math.round(e.nativeEvent.contentOffset.x / pageWidth));
  };

  return (
    <View style={[{ gap: spacing.sm }, style]}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        scrollEventThrottle={16}
      >
        {uris.map((uri, i) => (
          <Image key={`${uri}-${i}`} source={{ uri }} style={imageStyle} resizeMode="cover" />
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
        {uris.map((uri, i) => (
          <View
            key={`dot-${uri}-${i}`}
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === page ? theme.text : theme.border,
            }}
          />
        ))}
      </View>
    </View>
  );
}
