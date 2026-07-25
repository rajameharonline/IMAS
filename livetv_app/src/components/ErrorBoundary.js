import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.icon}>⚠️</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.error?.message || 'Unknown error'}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => this.setState({ hasError: false, error: null })}>
            <Text style={styles.btnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f', justifyContent: 'center', alignItems: 'center', padding: 32 },
  icon: { fontSize: 48, marginBottom: 16 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  message: { color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 32 },
  btn: { backgroundColor: '#e50914', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '700' },
});
