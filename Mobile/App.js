import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Constants from "expo-constants";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";

const FALLBACK_URL = "https://SEU-WEBAPP-AQUI.com";

export default function App() {
  const webViewRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [userCoords, setUserCoords] = useState(null);
  const [locationReady, setLocationReady] = useState(false);

  // Request permission and get the real device location via expo-location
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          setUserCoords({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracy: loc.coords.accuracy,
          });
        } else {
          console.warn("Location permission denied");
        }
      } catch (e) {
        console.warn("Location error:", e);
      } finally {
        // Always mark location as ready so the WebView can load
        setLocationReady(true);
      }
    })();
  }, []);

  const webAppUrl =
    Constants.expoConfig?.extra?.webAppUrl ||
    Constants.manifest?.extra?.webAppUrl ||
    FALLBACK_URL;

  // source is computed below after finalUrl

  const handleRetry = useCallback(() => {
    setHasError(false);
    setIsLoading(true);
    webViewRef.current?.reload();
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    webViewRef.current?.reload();
    setTimeout(() => setRefreshing(false), 700);
  }, []);

  const handleNavigationChange = useCallback((navState) => {
    setCanGoBack(navState.canGoBack);
  }, []);

  React.useEffect(() => {
    if (Platform.OS !== "android") {
      return undefined;
    }

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [canGoBack]);

  // Build the URL with native coords as query params so the web app uses them directly
  const finalUrl = useMemo(() => {
    if (!userCoords) return webAppUrl;
    const separator = webAppUrl.includes("?") ? "&" : "?";
    return `${webAppUrl}${separator}nativeLat=${userCoords.latitude}&nativeLng=${userCoords.longitude}`;
  }, [webAppUrl, userCoords]);

  const source = useMemo(() => ({ uri: finalUrl }), [finalUrl]);

  // Wait for location before rendering the WebView
  if (!locationReady) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0ea5e9" />
          <Text style={styles.message}>Obtendo sua localização...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (hasError) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.title}>Sem conexao</Text>
          <Text style={styles.message}>
            Nao foi possivel carregar o AquaWatch. Verifique sua internet e tente novamente.
          </Text>
          <TouchableOpacity style={styles.button} onPress={handleRetry}>
            <Text style={styles.buttonText}>Tentar novamente</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <WebView
        ref={webViewRef}
        source={source}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        geolocationEnabled
        startInLoadingState
        pullToRefreshEnabled
        bounces
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        mediaCapturePermissionGrantType="grant"
        onLoadStart={() => {
          setHasError(false);
          setIsLoading(true);
        }}
        onLoadEnd={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
        onHttpError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
        onNavigationStateChange={handleNavigationChange}
        renderLoading={() => (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#0ea5e9" />
            <Text style={styles.message}>Carregando AquaWatch...</Text>
          </View>
        )}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      />

      {isLoading ? (
        <View pointerEvents="none" style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#0ea5e9" />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
    color: "#0f172a",
    textAlign: "center",
  },
  message: {
    fontSize: 15,
    color: "#475569",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 22,
  },
  button: {
    marginTop: 18,
    backgroundColor: "#0ea5e9",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  loadingOverlay: {
    position: "absolute",
    right: 12,
    top: 12,
    backgroundColor: "rgba(255,255,255,0.85)",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
});
