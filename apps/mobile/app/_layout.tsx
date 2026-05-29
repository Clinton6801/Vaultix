import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: 'bold' },
        }}
      >
        {/* Welcome / Connect Wallet */}
        <Stack.Screen name="index" options={{ headerShown: false }} />

        {/* Tab screens (dashboard + notifications) – rendered via (tabs)/_layout */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

        {/* Full-screen detail screens */}
        <Stack.Screen name="escrow/[id]" options={{ title: 'Escrow Detail' }} />
        <Stack.Screen name="escrow/create" options={{ title: 'Create Escrow' }} />
        <Stack.Screen name="escrow/release" options={{ title: 'Release Milestone' }} />
      </Stack>
    </>
  );
}
