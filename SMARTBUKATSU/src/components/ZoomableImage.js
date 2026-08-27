import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
} from "react-native";
import {
  GestureHandlerRootView,
  PanGestureHandler,
  PinchGestureHandler,
  State,
} from "react-native-gesture-handler";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const PAN_ENABLED_SCALE = 1.01;

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

const ZoomableImage = ({
  uri,
  style,
  resizeMode = "contain",
  onZoomChange,
}) => {
  const pinchHandlerRef = useRef(null);
  const panHandlerRef = useRef(null);
  const baseScale = useRef(new Animated.Value(MIN_SCALE)).current;
  const pinchScale = useRef(new Animated.Value(MIN_SCALE)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const currentScale = useRef(MIN_SCALE);
  const currentTranslation = useRef({ x: 0, y: 0 });
  const panStartTranslation = useRef({ x: 0, y: 0 });
  const containerSize = useRef({ width: 0, height: 0 });
  const imageSize = useRef({ width: 0, height: 0 });
  const [zoomScale, setZoomScale] = useState(MIN_SCALE);

  const getPanBounds = (scaleValue) => {
    const { width: containerWidth, height: containerHeight } =
      containerSize.current;
    const { width: imageWidth, height: imageHeight } = imageSize.current;

    if (!containerWidth || !containerHeight) return { x: 0, y: 0 };

    let renderedWidth = containerWidth;
    let renderedHeight = containerHeight;
    if (
      resizeMode === "contain" &&
      imageWidth > 0 &&
      imageHeight > 0
    ) {
      const fitScale = Math.min(
        containerWidth / imageWidth,
        containerHeight / imageHeight,
      );
      renderedWidth = imageWidth * fitScale;
      renderedHeight = imageHeight * fitScale;
    }

    return {
      x: Math.max(0, (renderedWidth * scaleValue - containerWidth) / 2),
      y: Math.max(0, (renderedHeight * scaleValue - containerHeight) / 2),
    };
  };

  const setClampedTranslation = (x, y, scaleValue = currentScale.current) => {
    const bounds = getPanBounds(scaleValue);
    const nextTranslation = {
      x: clamp(x, -bounds.x, bounds.x),
      y: clamp(y, -bounds.y, bounds.y),
    };
    currentTranslation.current = nextTranslation;
    translateX.setValue(nextTranslation.x);
    translateY.setValue(nextTranslation.y);
  };

  useEffect(() => {
    currentScale.current = MIN_SCALE;
    currentTranslation.current = { x: 0, y: 0 };
    panStartTranslation.current = { x: 0, y: 0 };
    imageSize.current = { width: 0, height: 0 };
    baseScale.setValue(MIN_SCALE);
    pinchScale.setValue(MIN_SCALE);
    translateX.setValue(0);
    translateY.setValue(0);
    setZoomScale(MIN_SCALE);
    onZoomChange?.(false);
  }, [baseScale, onZoomChange, pinchScale, translateX, translateY, uri]);

  const handlePinchGesture = Animated.event(
    [{ nativeEvent: { scale: pinchScale } }],
    { useNativeDriver: true },
  );

  const handlePinchStateChange = ({ nativeEvent }) => {
    if (nativeEvent.oldState !== State.ACTIVE) return;

    const gestureScale = Number(nativeEvent.scale) || MIN_SCALE;
    const nextScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, currentScale.current * gestureScale),
    );
    currentScale.current = nextScale;
    baseScale.setValue(nextScale);
    pinchScale.setValue(MIN_SCALE);
    setClampedTranslation(
      currentTranslation.current.x,
      currentTranslation.current.y,
      nextScale,
    );
    setZoomScale(nextScale);
    onZoomChange?.(nextScale >= PAN_ENABLED_SCALE);
  };

  const handlePanGesture = ({ nativeEvent }) => {
    if (currentScale.current < PAN_ENABLED_SCALE) return;
    setClampedTranslation(
      panStartTranslation.current.x + nativeEvent.translationX,
      panStartTranslation.current.y + nativeEvent.translationY,
    );
  };

  const handlePanStateChange = ({ nativeEvent }) => {
    if (nativeEvent.state === State.ACTIVE) {
      panStartTranslation.current = { ...currentTranslation.current };
      return;
    }
    if (nativeEvent.oldState !== State.ACTIVE) return;
    setClampedTranslation(
      panStartTranslation.current.x + nativeEvent.translationX,
      panStartTranslation.current.y + nativeEvent.translationY,
    );
  };

  const handleLayout = ({ nativeEvent }) => {
    containerSize.current = nativeEvent.layout;
    setClampedTranslation(
      currentTranslation.current.x,
      currentTranslation.current.y,
    );
  };

  const handleImageLoad = ({ nativeEvent }) => {
    const source = nativeEvent.source || {};
    imageSize.current = {
      width: Number(source.width) || 0,
      height: Number(source.height) || 0,
    };
    setClampedTranslation(
      currentTranslation.current.x,
      currentTranslation.current.y,
    );
  };

  const scale = Animated.multiply(baseScale, pinchScale).interpolate({
    inputRange: [MIN_SCALE, MAX_SCALE],
    outputRange: [MIN_SCALE, MAX_SCALE],
    extrapolate: "clamp",
  });

  const resetZoom = () => {
    currentScale.current = MIN_SCALE;
    currentTranslation.current = { x: 0, y: 0 };
    panStartTranslation.current = { x: 0, y: 0 };
    baseScale.setValue(MIN_SCALE);
    pinchScale.setValue(MIN_SCALE);
    translateX.setValue(0);
    translateY.setValue(0);
    setZoomScale(MIN_SCALE);
    onZoomChange?.(false);
  };

  return (
    <GestureHandlerRootView
      style={[styles.container, style]}
      onLayout={handleLayout}
    >
      <PanGestureHandler
        ref={panHandlerRef}
        enabled={zoomScale >= PAN_ENABLED_SCALE}
        maxPointers={1}
        simultaneousHandlers={pinchHandlerRef}
        onGestureEvent={handlePanGesture}
        onHandlerStateChange={handlePanStateChange}
      >
        <Animated.View
          style={[
            styles.container,
            { transform: [{ translateX }, { translateY }] },
          ]}
        >
          <PinchGestureHandler
            ref={pinchHandlerRef}
            simultaneousHandlers={panHandlerRef}
            onGestureEvent={handlePinchGesture}
            onHandlerStateChange={handlePinchStateChange}
          >
            <Animated.View
              style={[styles.container, { transform: [{ scale }] }]}
            >
              <Animated.Image
                source={{ uri }}
                style={styles.image}
                resizeMode={resizeMode}
                onLoad={handleImageLoad}
              />
            </Animated.View>
          </PinchGestureHandler>
        </Animated.View>
      </PanGestureHandler>
      <TouchableOpacity
        style={styles.resetButton}
        onPress={resetZoom}
        accessibilityRole="button"
        accessibilityLabel="画像を元の大きさに戻す"
      >
        <Text style={styles.resetButtonText}>元の大きさ</Text>
      </TouchableOpacity>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  image: { width: "100%", height: "100%" },
  resetButton: {
    position: "absolute",
    left: 12,
    bottom: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 13,
    paddingVertical: 7,
    zIndex: 2,
  },
  resetButtonText: { color: "#ffffff", fontSize: 12, fontWeight: "bold" },
});

export default ZoomableImage;
